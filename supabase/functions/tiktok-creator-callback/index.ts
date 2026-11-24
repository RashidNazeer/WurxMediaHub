/**
 * tiktok-creator-callback
 * ---------------------------------------------------------------------------
 * The other half of the creator's OAuth round trip, and the only PUBLIC part of
 * it.
 *
 * WHY PUBLIC. The browser arrives here straight from tiktok.com and may carry
 * no Wurx session in that tab: a creator who started on their phone, approved in
 * TikTok's in-app browser, and came back has no cookie to show us. Demanding one
 * would break the flow for exactly the people it is built for.
 *
 * WHAT MAKES IT SAFE IS NOT OBSCURITY. It is the `state` nonce:
 *
 *   - minted by `tiktok-creator` for ONE signed-in creator, from the platform
 *     CSPRNG, and stored server side
 *   - looked up here, so the creator is read from OUR row and never from the
 *     request
 *   - BURNED on first use, in a conditional update, so a replayed callback
 *     finds nothing
 *   - expired after fifteen minutes regardless
 *
 * A `creator_id` is never accepted from the caller. There is no parameter for
 * one and adding it would hand anybody the ability to attach their TikTok
 * account to somebody else's profile.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import { displayCreds, exchangeCode, fetchUser, revoke } from '../_shared/tiktok-display.ts';

const Body = z.object({
  /* TikTok's authorisation code. Opaque, so only length and shape are checked. */
  code: z.string().trim().min(8).max(2048),
  /* Our own nonce: 32 random bytes as hex, exactly as minted. */
  state: z.string().trim().regex(/^[0-9a-f]{64}$/, 'That sign-in link is not valid'),
});

Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) => json(body, status, req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  let creds;
  try {
    creds = displayCreds();
  } catch (e) {
    return reply({ error: (e as Error).message }, 500);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply({ error: 'Send JSON' }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return reply({ error: parsed.error.issues[0]?.message ?? 'That request is not valid' }, 400);
  }
  const { code, state } = parsed.data;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /*
   * BURN THE NONCE IN ONE STATEMENT, and read the creator out of what it
   * returns. Doing this as select-then-update leaves a window where two
   * callbacks arriving together both pass; `used_at is null` inside the UPDATE
   * makes the database the thing that decides, and only one can win.
   */
  const { data: burned, error: burnErr } = await admin
    .from('creator_tiktok_oauth_states')
    .update({ used_at: new Date().toISOString() })
    .eq('state', state)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('creator_id')
    .maybeSingle();

  if (burnErr || !burned) {
    return reply({ error: 'That connection link has already been used or has expired.' }, 400);
  }
  const creatorId = burned.creator_id as string;

  /*
   * A SUSPENDED OR DEMOTED ACCOUNT CONNECTS NOTHING, and it is checked BEFORE
   * the code is exchanged.
   *
   * `tiktok-creator` checks `is_active` and the role before it mints a state,
   * but this function never re-checked either — so a nonce minted fifteen
   * minutes ago still worked for somebody suspended fourteen minutes ago.
   *
   * It runs here, ahead of the handshake, for two reasons: a code that will
   * never be used should not be spent, and a guard that sits behind a live
   * TikTok exchange cannot be tested without one.
   */
  const { data: actor } = await admin
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', creatorId)
    .maybeSingle();
  if (!actor?.is_active
    || !['applicant', 'creator', 'ops', 'admin', 'ads_manager', 'ops_lead'].includes(String(actor.role))) {
    return reply({ error: 'That account cannot connect a TikTok account.' }, 403);
  }

  /* ------------------------------------------------------- the handshake -- */
  let token;
  try {
    token = await exchangeCode(creds, code);
  } catch (e) {
    return reply({ error: (e as Error).message }, 502);
  }

  /*
   * THE GRANTED SCOPE DECIDES WHICH FIELDS WE MAY ASK FOR, and it comes from
   * TikTok rather than from `DISPLAY_SCOPES`. A creator can decline individual
   * permissions on the consent screen, and a token minted before a scope
   * existed simply does not carry it; asking about a field outside the grant
   * fails the WHOLE call rather than omitting that one field.
   */
  let who: Awaited<ReturnType<typeof fetchUser>> = {};
  try {
    who = await fetchUser(token.access_token, token.scope);
  } catch {
    /*
     * NOT FATAL. The token is good, which is the part that matters; we simply
     * have no display name to show yet and the next refresh will fill it in.
     * Failing the whole connection here would throw away a working grant over a
     * cosmetic field.
     */
  }

  const openId = token.open_id ?? who.open_id;
  if (!openId) return reply({ error: 'TikTok did not say which account that was' }, 502);

  const nowIso = new Date().toISOString();

  /* ═══ THREE GUARDS THAT WERE NOT HERE, ADDED 2026-09-28 ═══════════════
   *
   * This function resolved the creator from the burned nonce and then trusted
   * everything else. Two independent reviews of the signup design found the
   * same three holes in it, and signup is about to be built ON TOP of this —
   * so they are fixed here first rather than inherited.
   */

  /*
   * 2. AN ACCOUNT SOMEBODY ELSE HAS ALREADY CLAIMED IS NOT AVAILABLE.
   *
   * The older guard is a partial unique index on LIVE connections, so it stops
   * two live connections and nothing else: creator A could connect TikTok X,
   * disconnect, and creator B could then bind X and show X's videos as their
   * own. The identity ledger outlives the disconnect, so it can answer the
   * question the index cannot.
   *
   * Staff can release a claim, which is why the message says so rather than
   * reading as a dead end.
   */
  const { data: claimed } = await admin
    .from('tiktok_identities')
    .select('profile_id')
    .eq('open_id', openId)
    .is('released_at', null)
    .limit(1)
    .maybeSingle();
  if (claimed && claimed.profile_id && claimed.profile_id !== creatorId) {
    return reply({
      error: 'That TikTok account has already been used on another Wurx account. Ask the Wurx team to release it if it should be yours.',
    }, 409);
  }

  /*
   * 3. SWAPPING ACCOUNTS MUST NOT LEAVE THE OLD ONE BEHIND.
   *
   * Reconnecting with a DIFFERENT TikTok account used to overwrite the row and
   * stop there: the previous account's token stayed valid at TikTok, and its
   * videos stayed attached to this creator — somebody else's view counts on a
   * screen about money. Both are cleared here, before the new account is
   * written, so a failure halfway leaves no mixture.
   *
   * REVOKING IS SAFE ONLY BECAUSE THE ACCOUNT IS DIFFERENT. TikTok's revoke
   * ends the user's whole authorisation of this app, not one token — so it must
   * never run for an open_id that is still connected somewhere. Here it is by
   * definition the account being replaced.
   */
  const { data: previous } = await admin
    .from('creator_tiktok_connections')
    .select('open_id')
    .eq('creator_id', creatorId)
    .maybeSingle();

  if (previous?.open_id && previous.open_id !== openId) {
    const { data: oldTok } = await admin
      .from('creator_tiktok_tokens')
      .select('access_token')
      .eq('creator_id', creatorId)
      .maybeSingle();
    if (oldTok?.access_token) {
      /* Best effort: TikTok being unreachable must not block the new
         connection, and an un-revoked old token is a smaller problem than a
         creator who cannot connect at all. */
      try { await revoke(creds, oldTok.access_token); } catch { /* logged below */ }
    }
    const { error: vidErr } = await admin
      .from('creator_tiktok_videos')
      .delete()
      .eq('creator_id', creatorId);
    if (vidErr) console.error('[tiktok-creator-callback] clearing old videos failed', vidErr);

    await admin.from('audit_log').insert({
      actor_id: creatorId,
      actor_role: 'creator',
      action: 'tiktok_creator.account_swapped',
      subject_type: 'creator_tiktok_connection',
      subject_id: creatorId,
      detail: { from_open_id: previous.open_id, to_open_id: openId },
    });
  }

  const { error: connErr } = await admin.from('creator_tiktok_connections').upsert(
    {
      creator_id: creatorId,
      open_id: openId,
      union_id: who.union_id ?? null,
      display_name: who.display_name ?? null,
      avatar_url: who.avatar_url ?? null,

      /*
       * FROM user.info.profile AND user.info.stats, and every one is `?? null`
       * rather than `?? 0` or `?? ''`.
       *
       * A creator may decline these on the consent screen, and an older token
       * never had them, so "not known" has to survive as its own state all the
       * way to the card. A zero follower count is a number somebody would
       * believe about their own account, and being told you have no followers
       * when we simply did not ask is worse than a dash.
       */
      username: who.username ?? null,
      profile_deep_link: who.profile_deep_link ?? null,
      is_verified: who.is_verified ?? null,
      follower_count: who.follower_count ?? null,
      likes_count: who.likes_count ?? null,
      video_count: who.video_count ?? null,
      profile_synced_at: who.open_id || who.display_name ? nowIso : null,
      /*
       * WHAT TIKTOK SAYS THEY GRANTED, not what we asked for. A token
       * permanently carries the scopes it was minted with, so the only honest
       * record of "can we read their videos" is the one that came back.
       */
      scope: token.scope ?? '',
      connected_at: nowIso,
      last_error: null,
      // A reconnect after a disconnect has to clear this, or the screen keeps
      // saying they are disconnected while a live token sits behind it.
      revoked_at: null,
    },
    { onConflict: 'creator_id' }
  );
  /*
   * SAY WHICH WRITE FAILED AND WHY.
   *
   * Both of these used to answer with the same seven words, so a failure here
   * was indistinguishable from a failure two statements later, and neither
   * carried the reason Postgres gave. Rashid met exactly that on production on
   * 2026-09-04 — "Could not save that connection" and nothing else to go on,
   * on the screen his TikTok resubmission depends on.
   *
   * The database's own message is safe to show: it names a column or a
   * constraint, never a token. The tokens are in the OTHER statement and are
   * never interpolated into anything.
   */
  if (connErr) {
    console.error('[tiktok-creator-callback] connections upsert failed', connErr);
    /*
     * ONE TIKTOK ACCOUNT, ONE CREATOR — and the person who hits it deserves a
     * sentence, not the name of an index.
     *
     * `creator_tiktok_connections_one_account_idx` is deliberate: it stops two
     * Wurx profiles both binding the same TikTok account and both claiming its
     * videos. It is PARTIAL, on live connections only, so disconnecting frees
     * the account for whoever legitimately connects it next — which means this
     * is not a dead end, it is a two-step. Say the second step.
     *
     * Rashid met this on production on 2026-09-04, signing up fresh to record a
     * TikTok demo video while the same account was still connected to his
     * creator profile. What he saw was
     * "duplicate key value violates unique constraint ...one_account_idx".
     */
    const dup = connErr.code === '23505' || /duplicate key|unique constraint/i.test(connErr.message || '');
    if (dup && /one_account_idx/i.test(connErr.message || '')) {
      return reply({
        error: 'That TikTok account is already connected to another Wurx account. Open that account, disconnect TikTok there, then connect it here.',
      }, 409);
    }
    return reply({ error: `Could not save that connection (profile step): ${connErr.message}` }, 500);
  }

  const { error: tokErr } = await admin
    .from('creator_tiktok_tokens')
    .upsert(
      {
        creator_id: creatorId,
        access_token: token.access_token,
        refresh_token: token.refresh_token ?? null,
        access_expires_at: token.expires_in
          ? new Date(Date.now() + token.expires_in * 1000).toISOString()
          : null,
        refresh_expires_at: token.refresh_expires_in
          ? new Date(Date.now() + token.refresh_expires_in * 1000).toISOString()
          : null,
        updated_at: nowIso,
      },
      { onConflict: 'creator_id' }
    );
  if (tokErr) {
    console.error('[tiktok-creator-callback] tokens upsert failed', tokErr);
    return reply({ error: `Could not save that connection (token step): ${tokErr.message}` }, 500);
  }

  await admin.from('audit_log').insert({
    actor_id: creatorId,
    actor_role: 'creator',
    action: 'tiktok_creator.connected',
    subject_type: 'creator_tiktok_connection',
    subject_id: creatorId,
    /* Names and scopes, never the token. The schema comment on audit_log says
     * "never put secrets in here" and it means it. */
    detail: {
      display_name: who.display_name ?? null,
      username: who.username ?? null,
      scope: token.scope ?? '',
    },
  });

  return reply({ ok: true, displayName: who.display_name ?? null });
});
