#!/usr/bin/env node
/**
 * Attacks the creator TikTok connection as a real signed-in creator.
 *
 * The thing being protected here is unusually valuable: an OAuth token that can
 * read somebody's TikTok account. So this does not check that the screen hides
 * a button. It signs in as one creator and tries to reach another creator's
 * connection, their videos, and above all their TOKEN, through the API that the
 * browser actually talks to.
 *
 * It also attacks the OAuth state nonce, which is the only thing standing
 * between a PUBLIC callback and somebody else's account: guessed, replayed,
 * expired, and raced.
 *
 * Makes its own creators and removes them in a `finally`. Dev only.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/tiktok/check-creator-tiktok.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

assertDevProject(env.VITE_SUPABASE_URL, 'check-creator-tiktok.mjs');
const URL_BASE = env.VITE_SUPABASE_URL;
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const ok = (l) => { console.log(`  PASS  ${l}`); pass++; };
const bad = (l, d) => { console.error(`  FAIL  ${l}${d ? `\n        ${d}` : ''}`); fail++; };

const stamp = Date.now();
const A = { email: `tt-owner-${stamp}@wurx.test`, password: 'TtOwner!2026' };
const B = { email: `tt-spy-${stamp}@wurx.test`, password: 'TtSpy!2026' };
/*
 * NEVER PROMOTED, so this is a real applicant rather than a demoted creator.
 *
 * The first version of this test promoted B and then demoted them back, and the
 * demotion silently did not apply — so the suite reported the product broken
 * when the setup was. Whatever refuses that transition, an account that has
 * simply never been approved is the honest subject anyway: it is the state a
 * real applicant is actually in.
 */
const C = { email: `tt-applicant-${stamp}@wurx.test`, password: 'TtApplicant!2026' };
const made = [];

const signIn = async (who) => {
  const c = createClient(URL_BASE, PUBLISHABLE, { auth: { persistSession: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: who.email, password: who.password });
  if (error) throw new Error(`sign-in failed for ${who.email}: ${error.message}`);
  return { client: c, token: data.session.access_token };
};

const callFn = async (fn, token, body) => {
  const res = await fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = JSON.parse(await res.text()); } catch { /* not json */ }
  return { status: res.status, json };
};

try {
  for (const who of [A, B, C]) {
    const { data, error } = await admin.auth.admin.createUser({
      email: who.email, password: who.password, email_confirm: true,
    });
    if (error) throw error;
    who.id = data.user.id;
    made.push(who.id);
    // C is deliberately left at whatever a new sign-up gets, which is 'applicant'.
    if (who !== C) {
      await admin.from('profiles').update({ role: 'creator', tier: 'pro' }).eq('id', who.id);
    }
  }

  {
    const { data: c } = await admin.from('profiles').select('role').eq('id', C.id).single();
    if (c?.role !== 'applicant') {
      throw new Error(`a fresh sign-up is '${c?.role}', not 'applicant'; this test assumes it`);
    }
  }

  /* A has a connection, with a token, exactly as the callback would leave it. */
  await admin.from('creator_tiktok_connections').insert({
    creator_id: A.id,
    open_id: `open-${stamp}`,
    display_name: 'Owner Account',
    /*
     * THE FULL FOUR, because that is what the app now asks for and what section
     * [7] reads back. A connection stored with the narrower legacy pair would
     * make every profile assertion below pass on an absent column instead of a
     * present one.
     */
    scope: 'user.info.basic,user.info.profile,user.info.stats,video.list',
    username: 'owner_handle',
    profile_deep_link: 'https://www.tiktok.com/@owner_handle',
    is_verified: true,
    follower_count: 4321,
    likes_count: 987_654,
    video_count: 12,
    profile_synced_at: new Date().toISOString(),
  });
  /*
   * THE SETUP IS PROVEN BEFORE ANYTHING IS ASSERTED ABOUT IT.
   *
   * The first version of this file discarded the insert's error and then
   * asserted "a creator cannot read the token table" — which passed, on
   * PGRST106, an error meaning the SCHEMA DOES NOT EXIST rather than one
   * meaning permission denied. The table was empty because this very insert had
   * failed the same way, so the check was asserting emptiness and could not
   * have failed. It reported a broken feature as secure.
   *
   * So: insert, check the error, and read the row back. A test about whether
   * something is reachable is worthless unless the thing is known to be there.
   */
  {
    const { error } = await admin.from('creator_tiktok_tokens').insert({
      creator_id: A.id,
      access_token: 'SECRET-ACCESS-TOKEN-DO-NOT-LEAK',
      refresh_token: 'SECRET-REFRESH-TOKEN-DO-NOT-LEAK',
      access_expires_at: new Date(Date.now() + 3600_000).toISOString(),
    });
    if (error) throw new Error(`setup failed: could not store a token: ${error.code} ${error.message}`);
    const { data: check } = await admin
      .from('creator_tiktok_tokens').select('access_token').eq('creator_id', A.id).maybeSingle();
    if (check?.access_token !== 'SECRET-ACCESS-TOKEN-DO-NOT-LEAK') {
      throw new Error('setup failed: the token did not read back; every check below would be vacuous');
    }
  }
  await admin.from('creator_tiktok_videos').insert({
    creator_id: A.id, video_id: `vid-${stamp}`, title: 'Owner video',
    view_count: 1234, like_count: 56, comment_count: 7, share_count: 8,
  });

  const spy = await signIn(B);
  const owner = await signIn(A);

  console.log('\n[1] The token is unreachable from a browser');
  /*
   * A REAL DENIAL, NOT AN ABSENCE. `42501` is insufficient privilege, which is
   * what a closed door returns. PGRST106 ("invalid schema") or an empty list
   * would mean the check never reached the thing it is guarding, and that is
   * accepted as a FAILURE here rather than as a pass.
   */
  const deniedProperly = (error, data, label) => {
    if (error?.code === '42501') { ok(`${label} (42501 insufficient privilege)`); return; }
    if (error) { bad(`${label}: refused for the WRONG reason (${error.code} ${error.message})`); return; }
    if (!data?.length) { bad(`${label}: returned no rows, but a token IS stored — this check is vacuous`); return; }
    bad(`${label}: THE TOKEN WAS READABLE`, JSON.stringify(data).slice(0, 200));
  };
  {
    const { data, error } = await spy.client.from('creator_tiktok_tokens').select('*');
    deniedProperly(error, data, 'another creator cannot read creator_tiktok_tokens');
  }
  {
    const { data, error } = await owner.client.from('creator_tiktok_tokens').select('*');
    deniedProperly(error, data, 'even the OWNER cannot read their own token row');
  }
  {
    /* And it is not hiding in the table they CAN read. */
    const { data } = await owner.client.from('creator_tiktok_connections').select('*');
    const blob = JSON.stringify(data ?? []);
    if (!/SECRET-|access_token|refresh_token/.test(blob)) ok('no token field appears in the connection row');
    else bad('a token leaked through creator_tiktok_connections', blob.slice(0, 200));
  }

  console.log('\n[2] One creator cannot see another');
  {
    const { data } = await spy.client.from('creator_tiktok_connections').select('creator_id');
    if (!data || data.length === 0) ok('a creator with no connection sees no connections at all');
    else bad(`the spy sees ${data.length} connection row(s)`, JSON.stringify(data).slice(0, 200));
  }
  {
    const { data } = await spy.client.from('creator_tiktok_videos').select('video_id, view_count');
    if (!data || data.length === 0) ok("a creator cannot read another creator's video figures");
    else bad(`the spy sees ${data.length} video row(s)`, JSON.stringify(data).slice(0, 200));
  }
  {
    const { data } = await owner.client.from('creator_tiktok_connections').select('creator_id, display_name');
    if (data?.length === 1 && data[0].creator_id === A.id) ok('the owner reads their own connection, and only theirs');
    else bad('the owner cannot read their own connection', JSON.stringify(data));
  }

  console.log('\n[3] The nonce table is nobody’s business');
  {
    const { data, error } = await spy.client.from('creator_tiktok_oauth_states').select('*');
    if (error || !data?.length) ok(`creator_tiktok_oauth_states is unreadable (${error?.code ?? 'empty'})`);
    else bad('a creator read the OAuth state table', JSON.stringify(data).slice(0, 200));
  }

  console.log('\n[4] No creator can write a connection directly');
  {
    const { error } = await spy.client.from('creator_tiktok_connections')
      .insert({ creator_id: B.id, open_id: 'forged', scope: 'video.list' });
    if (error) ok(`insert refused (${error.code})`);
    else bad('a creator INSERTED a connection row');
  }
  {
    const { error, data } = await spy.client.from('creator_tiktok_connections')
      .update({ open_id: 'hijacked' }).eq('creator_id', A.id).select();
    if (error || !data?.length) ok("update on somebody else's connection changed nothing");
    else bad('a creator UPDATED another creator’s connection');
  }
  {
    const { error, data } = await spy.client.from('creator_tiktok_videos')
      .delete().eq('creator_id', A.id).select();
    if (error || !data?.length) ok("delete on somebody else's videos changed nothing");
    else bad('a creator DELETED another creator’s videos');
  }

  console.log('\n[5] The state nonce, attacked');
  {
    const r = await callFn('tiktok-creator-callback', null, { code: 'x'.repeat(20), state: 'f'.repeat(64) });
    if (r.status >= 400) ok(`a guessed nonce is refused (${r.status})`);
    else bad('a guessed nonce was accepted', JSON.stringify(r.json));
  }
  {
    const r = await callFn('tiktok-creator-callback', null, { code: 'x'.repeat(20), state: 'not-hex' });
    if (r.status === 400) ok('a malformed nonce is refused by validation');
    else bad('a malformed nonce got past validation', JSON.stringify(r.json));
  }
  {
    /* An EXPIRED nonce that really exists must still be refused. */
    const expired = 'a'.repeat(64);
    await admin.from('creator_tiktok_oauth_states').insert({
      state: expired, creator_id: A.id,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const r = await callFn('tiktok-creator-callback', null, { code: 'x'.repeat(20), state: expired });
    if (r.status >= 400) ok(`an expired nonce is refused (${r.status})`);
    else bad('an expired nonce was accepted');
  }
  {
    /*
     * REPLAY. The first call burns the nonce and then fails at TikTok, because
     * the credentials on dev are placeholders. That is exactly the interesting
     * case: the burn must happen BEFORE the exchange, so a second attempt finds
     * nothing left even though the first never completed.
     */
    const live = 'b'.repeat(64);
    await admin.from('creator_tiktok_oauth_states').insert({
      state: live, creator_id: A.id,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    });
    const first = await callFn('tiktok-creator-callback', null, { code: 'x'.repeat(20), state: live });
    const second = await callFn('tiktok-creator-callback', null, { code: 'x'.repeat(20), state: live });

    const { data: row } = await admin
      .from('creator_tiktok_oauth_states').select('used_at').eq('state', live).single();
    if (row?.used_at) ok('the nonce was burned on first use, before the TikTok exchange');
    else bad('the nonce was NOT burned', JSON.stringify(row));

    if (second.status === 400) ok(`a replayed nonce is refused (${second.status})`);
    else bad('a replayed nonce was accepted', JSON.stringify(second.json));

    if (first.status >= 400) ok(`the first call still failed at TikTok as expected (${first.status})`);
    else bad('the placeholder credentials somehow succeeded');
  }

  console.log('\n[6] The authenticated function refuses strangers');
  {
    const r = await callFn('tiktok-creator', null, { action: 'connect.start' });
    if (r.status === 401) ok('a signed-out caller is refused (401)');
    else bad(`a signed-out caller got ${r.status}`, JSON.stringify(r.json));
  }
  {
    /* AN APPLICANT IS ALLOWED, and this assertion used to say the opposite.
       The gate was deliberately widened on 2026-09-04 (c712f8a) because the
       route that draws the card already admitted applicants, so every applicant
       who signed up saw a Connect button and got a bare red "Not allowed" from
       this function — two allow-lists for one screen, disagreeing about exactly
       one role. This check was last touched on 2026-08-26 and has been failing
       ever since, which nobody noticed because it fails one assertion out of
       29 and the suite is not run on a schedule.

       It matters more now than it did: the TikTok-first signup flow depends on
       an applicant being able to connect before they are approved. */
    const applicant = await signIn(C);
    const r = await callFn('tiktok-creator', applicant.token, { action: 'connect.start' });
    if (r.status === 200) ok('an applicant IS allowed to connect (200), as intended since 2026-09-04');
    else bad(`an applicant got ${r.status}, expected 200`, JSON.stringify(r.json));
  }
  {
    /* A suspended creator likewise. */
    await admin.from('profiles').update({ is_active: false }).eq('id', B.id);
    const fresh = await signIn(B);
    const r = await callFn('tiktok-creator', fresh.token, { action: 'connect.start' });
    if (r.status === 403) ok('a suspended account is refused (403)');
    else bad(`a suspended account got ${r.status}`, JSON.stringify(r.json));
    await admin.from('profiles').update({ is_active: true }).eq('id', B.id);
  }
  {
    /*
     * THE ONE THAT MATTERS MOST. There is no creator_id parameter, so a caller
     * cannot name a victim. Sending one anyway must change nothing: the nonce
     * has to be minted against the CALLER.
     */
    const fresh = await signIn(B);
    const r = await callFn('tiktok-creator', fresh.token, {
      action: 'connect.start', creator_id: A.id, creatorId: A.id,
    });
    if (r.status !== 200) {
      bad(`connect.start failed for a legitimate creator (${r.status})`, JSON.stringify(r.json));
    } else {
      const url = new URL(r.json.url);
      const state = url.searchParams.get('state');

      /*
       * THE SCOPE ON THE LIVE AUTHORISE URL, not the one in the source.
       *
       * This is the string TikTok actually validates, and asking for a scope
       * the app does not have makes TikTok refuse the whole URL — the Connect
       * button stops working for everybody, immediately, with no error anywhere
       * on our side. That shipped to production on 2026-08-26 and this is the
       * check that would have caught it: section [8] reads the source, which is
       * only a proxy for what the Edge Function is really sending.
       */
      const sent = (url.searchParams.get('scope') ?? '').split(',').filter(Boolean);
      const wanted = ['user.info.basic', 'video.list'];
      const matches = sent.length === wanted.length && wanted.every((x, i) => sent[i] === x);
      if (matches) ok(`the live authorise URL asks for exactly: ${sent.join(', ')}`);
      else bad('THE DEPLOYED FUNCTION ASKS FOR THE WRONG SCOPES', `sending: ${sent.join(', ') || '(none)'}`);
      const { data: minted } = await admin
        .from('creator_tiktok_oauth_states').select('creator_id').eq('state', state).single();
      if (minted?.creator_id === B.id) ok('a forged creator_id in the body is ignored; the nonce belongs to the caller');
      else bad('THE NONCE WAS MINTED FOR THE VICTIM', JSON.stringify(minted));
    }
  }
  console.log('\n[7] The profile and stats columns, and who may read them');
  {
    /*
     * PROVE THE COLUMNS ARE THERE BEFORE ASSERTING ANYTHING ABOUT THEM.
     *
     * Every check below this point is about a value in a column added on
     * 2026-08-26. Run against a database without that migration, a naive
     * version would report "the spy cannot read the follower count" and pass —
     * on a column that does not exist. That is the exact shape of the bug that
     * has now bitten this repo four times, so the setup is verified first and
     * the whole section is failed loudly if it is not there.
     */
    const { data: seed, error } = await admin
      .from('creator_tiktok_connections')
      .select('username, is_verified, follower_count, likes_count, video_count')
      .eq('creator_id', A.id)
      .maybeSingle();

    if (error || !seed) {
      bad('setup: the profile columns did not read back — every check in [7] would be vacuous',
        error ? `${error.code} ${error.message}` : 'no row');
    } else if (seed.follower_count !== 4321 || seed.username !== 'owner_handle' || seed.is_verified !== true) {
      bad('setup: the profile columns did not round-trip', JSON.stringify(seed));
    } else {
      ok('the profile and stats columns exist and hold what was written');

      /* bigint: a large account's lifetime likes must survive intact. */
      if (seed.likes_count === 987_654) ok('likes_count round-trips (bigint, not a truncated int)');
      else bad('likes_count came back wrong', String(seed.likes_count));
    }
  }
  {
    const { data } = await owner.client
      .from('creator_tiktok_connections')
      .select('username, follower_count, likes_count, video_count, is_verified')
      .eq('creator_id', A.id)
      .maybeSingle();
    if (data?.follower_count === 4321 && data?.username === 'owner_handle') {
      ok('the owner reads their own follower count and handle');
    } else {
      bad('the owner cannot read their own profile figures', JSON.stringify(data));
    }
  }
  {
    /* And the spy still gets nothing, now that there is more to want. */
    const { data } = await spy.client
      .from('creator_tiktok_connections')
      .select('username, follower_count, profile_deep_link');
    if (!data || data.length === 0) ok("a creator cannot read another creator's handle or follower count");
    else bad(`the spy read ${data.length} profile row(s)`, JSON.stringify(data).slice(0, 200));
  }

  console.log('\n[8] The scope contract: the code, the consent list and the application agree');
  {
    /*
     * A SOURCE-LEVEL CHECK, PINNED TO WHAT THE APP ACTUALLY GRANTS.
     *
     * The two scopes below are what the Scopes page on developers.tiktok.com
     * lists, and what the app was approved for. The two ways of drifting from
     * it fail very differently, and both happened on 2026-08-26:
     *
     *   MORE here than on the app  ->  TikTok refuses the authorise URL and the
     *                                  Connect button stops working for everyone.
     *   FEWER here than on the app ->  rejected at review as "requests
     *                                  permissions it does not use".
     *
     * The first was shipped to production that day, on the strength of a
     * SUBMISSION DIALOG that listed four scopes when the app's own Scopes page
     * listed two. **The app's Scopes page is the authority, not the dialog.**
     *
     * Widening this is a deliberate act that also touches the app's Scopes
     * page, the demo video, the consent list on the card and /privacy.
     */
    const EXPECTED = ['user.info.basic', 'video.list'];

    const src = readFileSync('supabase/functions/_shared/tiktok-display.ts', 'utf8');
    const block = src.match(/export const DISPLAY_SCOPES = \[([^\]]*)\]/);
    if (!block) {
      bad('DISPLAY_SCOPES could not be found at all — this check cannot run');
    } else {
      const found = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
      const same =
        found.length === EXPECTED.length && EXPECTED.every((x, i) => found[i] === x);
      if (same) ok(`DISPLAY_SCOPES matches the app's Scopes page: ${found.join(', ')}`);
      else bad("DISPLAY_SCOPES no longer matches the app's Scopes page", `code has: ${found.join(', ') || '(none)'}`);
    }

    /*
     * The field list must stay GATED. Requesting a profile field on a token
     * that never got that scope fails the whole user/info call, which is how a
     * connection made before today would break.
     */
    if (/granted\.has\('user\.info\.profile'\)/.test(src) && /granted\.has\('user\.info\.stats'\)/.test(src)) {
      ok('the user/info field list is gated on the scopes actually granted');
    } else {
      bad('the user/info field list is no longer gated on the granted scope');
    }

    /*
     * AND THE PROMISE ON THE SCREEN MUST KEEP UP. This list is what somebody
     * reads while deciding to trust us, and it silently became untrue the
     * moment two scopes were added.
     */
    const card = readFileSync('src/components/creator/account/AccountMenu.tsx', 'utf8');
    const privacy = readFileSync('src/routes/legal/Privacy.tsx', 'utf8');
    if (card.length < 1000 || privacy.length < 1000) {
      bad('the card or the privacy page could not be read — the promise check would be vacuous');
    } else {
      // The account menu no longer narrates; the consent wording lives on /privacy.
      if (/view, like, comment and share/i.test(privacy)) {
        ok('/privacy names what the video permission reads');
      } else {
        bad('/privacy no longer tells a creator what the requested scopes read');
      }

      /*
       * AND IT MUST NOT PROMISE WHAT WE CANNOT READ. With only these two
       * scopes there is no follower count to have, so a card or a privacy page
       * that mentions one is over-claiming — the same drift as under-claiming,
       * pointing the other way. Both pages said it for about two hours.
       */
      const wantsStats = EXPECTED.includes('user.info.stats');
      const cardClaims = /follower count/i.test(card);
      const privacyClaims = /<strong>Your account totals/i.test(privacy);
      if (cardClaims === wantsStats && privacyClaims === wantsStats) {
        ok(`the card and /privacy claim the follower count only if we ask for it (we do not)`);
      } else {
        bad(
          'the card or /privacy describes data the requested scopes cannot reach',
          `card mentions followers: ${cardClaims}, privacy lists account totals: ${privacyClaims}, scope requested: ${wantsStats}`
        );
      }
    }
  }

} finally {
  await admin.from('creator_tiktok_oauth_states').delete().in('creator_id', made);
  /*
   * DELETE THE IDENTITY CLAIMS TOO, BEFORE THE ACCOUNTS.
   *
   * `tiktok_identities.profile_id` is ON DELETE SET NULL on purpose — a claim
   * has to outlive the account, or deleting a creator would silently unbar the
   * TikTok account they applied with. Right for the product, wrong for a test
   * fixture: every run of this suite otherwise left an orphan behind, shown on
   * the Creator accounts screen as "A TikTok account · the account that claimed
   * it has been deleted". Four had already piled up before anyone looked.
   */
  await admin.from('tiktok_identities').delete().in('profile_id', made);
  for (const id of made) await admin.auth.admin.deleteUser(id);
  console.log('\n[cleanup] test creators, their rows and their TikTok claims removed');
}

console.log('\n' + '='.repeat(70));
if (fail) {
  console.error(`${fail} failed, ${pass} passed.\n`);
  process.exit(1);
}
console.log(`${pass} checks passed. A creator's TikTok token is theirs alone.\n`);
