/**
 * tiktok-creator
 * ---------------------------------------------------------------------------
 * Everything a CREATOR does with their own TikTok account: start a connection,
 * refresh the figures, and disconnect.
 *
 * It does NOT finish the OAuth handshake. That lives in `tiktok-creator-callback`,
 * which is public because somebody coming back from tiktok.com may have no
 * session in that tab, and keeping the two apart means the public surface is one
 * action instead of three.
 *
 * NOT THE ADS CONNECTION. That one is admin-only and authorises a BRAND's ad
 * account on business-api.tiktok.com. This authorises a CREATOR's own account on
 * open.tiktokapis.com, and the creator does it for themselves. Different app,
 * different credentials, different host. See `_shared/tiktok-display.ts`.
 *
 * The identity rule is the same as everywhere else here:
 *   1. Verify the access token with the auth server. Not decode it.
 *   2. Read the caller's row FROM THE PROFILES TABLE, because a JWT claim can be
 *      an hour stale.
 *   3. Never accept a creator_id from the client. It is always `auth.uid()`.
 *   4. No token is ever in a reply. Not once, not to anybody.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  authorizeUrl,
  displayCreds,
  fetchUser,
  listVideos,
  refreshToken,
  revoke,
} from '../_shared/tiktok-display.ts';

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('connect.start') }),
  z.object({ action: z.literal('videos.refresh') }),
  z.object({ action: z.literal('disconnect') }),
  /*
   * A DIAGNOSTIC, ADMIN ONLY. Same precedent as `connection.probe` on the ads
   * function: some questions can only be answered by asking TikTok, and the
   * credentials live in here rather than anywhere a laptop can reach.
   *
   * It asks the token endpoint to redeem a deliberately invalid code. That is
   * enough to separate the two failures that look identical from outside:
   *   - a bad client key or secret  -> TikTok complains about the CLIENT
   *   - good credentials, bad code  -> TikTok complains about the CODE
   * The second means the credentials are fine and something else is wrong.
   *
   * It reports the SHAPE of the credentials, never their value: a length, a
   * prefix and whether anything invisible is riding along.
   */
  z.object({ action: z.literal('creds.probe') }),
]);

/** How long a half-finished connection may sit before the nonce dies. */
const STATE_TTL_MINUTES = 15;

Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) => json(body, status, req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  let creds;
  try {
    creds = displayCreds();
  } catch (e) {
    return reply({ error: (e as Error).message }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Not signed in' }, 401);

  // ---------------------------------------------------------- who is this --
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) return reply({ error: 'Not signed in' }, 401);

  // Service role from here on. Nothing above this line was trusted.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: actor, error: actorErr } = await admin
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('id', userData.user.id)
    .single();
  if (actorErr || !actor) return reply({ error: 'Not allowed' }, 403);

  /*
   * A SUSPENDED ACCOUNT CONNECTS NOTHING.
   *
   * APPLICANTS ARE ALLOWED, changed 2026-09-04. They were not, on the
   * reasoning that an unapproved applicant "has no work here to measure" —
   * which is true of their SALES and false of this. The route that draws the
   * card admits `['applicant', 'creator']`, so every applicant who signed up
   * was shown a Connect button and then handed a bare red "Not allowed" by
   * this function. Two allow-lists for one screen, maintained in different
   * files, disagreeing about exactly one role.
   *
   * Connecting is harmless before approval: it reads that person's own public
   * video counts and shows them only to them. It is also the path a TikTok
   * reviewer takes — sign up, connect, see the figures — and the app was
   * rejected once already for looking closed.
   *
   * Staff stay on the list: an ops person testing their own account is
   * legitimate, and the connection is theirs either way.
   */
  if (!actor.is_active) return reply({ error: 'Not allowed' }, 403);
  if (!['applicant', 'creator', 'ops', 'admin', 'ads_manager', 'ops_lead'].includes(actor.role)) {
    return reply({ error: 'Not allowed' }, 403);
  }

  // ------------------------------------------------------------ the input --
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
  const input = parsed.data;
  const creatorId = actor.id; // NEVER from the client.

  /* --------------------------------------------------------- creds.probe -- */
  if (input.action === 'creds.probe') {
    if (actor.role !== 'admin') return reply({ error: 'Not allowed' }, 403);

    const raw = {
      key: Deno.env.get('TIKTOK_CREATOR_CLIENT_KEY') ?? '',
      secret: Deno.env.get('TIKTOK_CREATOR_CLIENT_SECRET') ?? '',
      redirect: Deno.env.get('TIKTOK_CREATOR_REDIRECT_URI') ?? '',
    };

    /* Shape only. A prefix and a length identify a key without revealing it. */
    const describe = (v: string) => ({
      length: v.length,
      trimmedLength: v.trim().length,
      /*
       * `/\s/`, WITH THE BACKSLASH. This read `/s/` — a regex matching the
       * LETTER s — so it answered "yes, whitespace" for any credential
       * containing an s, which is most of them. Harmless only because it errs
       * loud rather than quiet; the sibling bug in the same family (a check
       * that passes when its subject is absent) is the one that costs days.
       */
      hasWhitespace: /\s/.test(v),
      prefix: v.trim().slice(0, 4),
      suffix: v.trim().slice(-2),
    });

    const answer = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: creds.clientKey,
        client_secret: creds.clientSecret,
        code: 'deliberately-invalid-code-for-diagnosis',
        grant_type: 'authorization_code',
        redirect_uri: creds.redirectUri,
      }),
    });
    const body = await answer.json().catch(() => null);

    return reply({
      key: describe(raw.key),
      secret: describe(raw.secret),
      redirect: raw.redirect,
      tiktokStatus: answer.status,
      /* Verbatim, because the exact wording is the whole diagnostic. */
      tiktok: body,
    });
  }

  /* ------------------------------------------------------- connect.start -- */
  if (input.action === 'connect.start') {
    /*
     * try/catch, NOT `.catch()`.
     *
     * `admin.rpc(...)` returns a PostgrestBuilder, which is a Thenable and not a
     * Promise: it implements `then` and has no `catch`. Calling `.catch()` on it
     * throws "not a function" BEFORE the request is even made, which surfaced as
     * a 500 with a non-JSON body — the shape of an unhandled crash rather than
     * of any error this function knows how to describe. `check-creator-tiktok`
     * caught it on the first run.
     *
     * Sweeping is housekeeping and its failure must never stop somebody
     * connecting their account, so the result is deliberately ignored.
     */
    try {
      await admin.rpc('creator_tiktok_sweep_states');
    } catch {
      /* housekeeping only */
    }

    /*
     * A CRYPTOGRAPHIC NONCE, not a timestamp or a uuid v4 of convenience. It is
     * the only thing standing between the public callback and somebody else's
     * account, so it comes from the platform's CSPRNG.
     */
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    const state = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

    /*
     * ONE LIVE NONCE PER CREATOR, added 2026-09-28.
     *
     * Nothing used to retire a creator's earlier unused states, so pressing
     * Connect five times left five usable nonces, each good for fifteen
     * minutes. That widens the only window an attacker has: TikTok does not
     * support PKCE for web apps (their docs say `code_verifier` is "required
     * for mobile and desktop app only"), so a code cannot be cryptographically
     * bound to the browser that started the flow, and the defence is simply to
     * keep the window narrow and the code out of sight.
     *
     * Abandoning a connect and starting again is the ordinary case and still
     * works — the newest nonce is the live one.
     */
    await admin
      .from('creator_tiktok_oauth_states')
      .update({ used_at: new Date().toISOString() })
      .eq('creator_id', creatorId)
      .is('used_at', null);

    const { error: stateErr } = await admin.from('creator_tiktok_oauth_states').insert({
      state,
      creator_id: creatorId,
      expires_at: new Date(Date.now() + STATE_TTL_MINUTES * 60_000).toISOString(),
    });
    if (stateErr) return reply({ error: 'Could not start the connection' }, 500);

    return reply({ url: authorizeUrl(creds, state) });
  }

  /* ---------------------------------------------------------- disconnect -- */
  if (input.action === 'disconnect') {
    const { data: tok } = await admin
      .from('creator_tiktok_tokens')
      .select('access_token')
      .eq('creator_id', creatorId)
      .maybeSingle();

    /*
     * TELL TIKTOK FIRST, then forget locally — but never let their answer stop
     * us. If TikTok refuses the revoke we still drop our copy: leaving a
     * creator connected in our database because a third party had a bad minute
     * is exactly the wrong way round.
     */
    if (tok?.access_token) {
      try {
        await revoke(creds, tok.access_token);
      } catch {
        /* logged by absence: the row goes either way */
      }
    }

    await admin.from('creator_tiktok_tokens').delete().eq('creator_id', creatorId);
    await admin.from('creator_tiktok_videos').delete().eq('creator_id', creatorId);
    await admin
      .from('creator_tiktok_connections')
      .update({
        revoked_at: new Date().toISOString(),
        last_error: null,
        /*
         * CLEARED, because the videos it referred to were just deleted. Left
         * alone, a reconnect showed "Updated <date>" above an empty list, which
         * reads as figures that failed to load rather than as figures nobody
         * has fetched yet.
         */
        last_synced_at: null,
      })
      .eq('creator_id', creatorId);

    await admin.from('audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'tiktok_creator.disconnected',
      subject_type: 'creator_tiktok_connection',
      subject_id: creatorId,
      detail: {},
    });

    return reply({ ok: true });
  }

  /* ------------------------------------------------------ videos.refresh -- */
  const { data: conn } = await admin
    .from('creator_tiktok_connections')
    .select('creator_id, revoked_at, scope')
    .eq('creator_id', creatorId)
    .maybeSingle();

  if (!conn || conn.revoked_at) return reply({ error: 'Connect your TikTok account first' }, 409);

  const { data: tok } = await admin
    .from('creator_tiktok_tokens')
    .select('access_token, refresh_token, access_expires_at')
    .eq('creator_id', creatorId)
    .maybeSingle();
  if (!tok) return reply({ error: 'Connect your TikTok account first' }, 409);

  /*
   * REFRESH ON A MARGIN, not on expiry. A token that dies between our check and
   * TikTok's read produces an error a creator cannot act on, so anything inside
   * two minutes of the end is treated as already gone.
   */
  let accessToken = tok.access_token as string;
  const expiresAt = tok.access_expires_at ? new Date(tok.access_expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() < 120_000 && tok.refresh_token) {
    try {
      const fresh = await refreshToken(creds, tok.refresh_token as string);
      accessToken = fresh.access_token;
      await admin
        
        .from('creator_tiktok_tokens')
        .update({
          access_token: fresh.access_token,
          refresh_token: fresh.refresh_token ?? tok.refresh_token,
          access_expires_at: fresh.expires_in
            ? new Date(Date.now() + fresh.expires_in * 1000).toISOString()
            : null,
          refresh_expires_at: fresh.refresh_expires_in
            ? new Date(Date.now() + fresh.refresh_expires_in * 1000).toISOString()
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq('creator_id', creatorId);
    } catch (e) {
      await admin
        .from('creator_tiktok_connections')
        .update({ last_error: (e as Error).message })
        .eq('creator_id', creatorId);
      return reply({ error: 'TikTok would not renew the connection. Reconnect to fix it.' }, 502);
    }
  }

  /*
   * THE PROFILE BLOCK IS RE-READ ON EVERY REFRESH, not frozen at connect time.
   *
   * A follower count that never moves is worse than no follower count: it looks
   * like a live figure and is actually the number they had the day they linked
   * their account. Same pass, same button, so "Refresh" means one thing.
   *
   * NON-FATAL, DELIBERATELY, and the ordering says why: the videos are what a
   * creator pressed the button for. Losing the whole refresh because TikTok
   * declined one profile field would trade the thing they wanted for the thing
   * they did not ask about. The stale profile simply stays.
   *
   * `conn.scope` and not `DISPLAY_SCOPES`: this token carries whatever it was
   * minted with, which for anything connected before 2026-08-26 is the narrower
   * pair, and for a creator who declined a permission is narrower still.
   */
  try {
    const who = await fetchUser(accessToken, conn.scope);
    await admin
      .from('creator_tiktok_connections')
      .update({
        display_name: who.display_name ?? null,
        avatar_url: who.avatar_url ?? null,
        username: who.username ?? null,
        profile_deep_link: who.profile_deep_link ?? null,
        is_verified: who.is_verified ?? null,
        /* null, never 0. A wrong zero about your own account reads as true. */
        follower_count: who.follower_count ?? null,
        likes_count: who.likes_count ?? null,
        video_count: who.video_count ?? null,
        profile_synced_at: new Date().toISOString(),
      })
      .eq('creator_id', creatorId);
  } catch {
    /* the videos below are the job; a stale profile is not worth failing over */
  }

  try {
    const { videos } = await listVideos(accessToken);

    if (videos.length > 0) {
      const rows = videos.map((v) => ({
        creator_id: creatorId,
        video_id: v.id,
        title: v.title ?? null,
        cover_image_url: v.cover_image_url ?? null,
        share_url: v.share_url ?? null,
        duration: v.duration ?? null,
        // TikTok's create_time is unix SECONDS, not milliseconds. Reading it as
        // milliseconds puts every video in January 1970 and sorts them wrongly.
        posted_at: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
        /*
         * `?? null` and NOT `?? 0`. A field TikTok declines to return has to
         * read as "we do not know" on the screen. A zero is a number a creator
         * would believe, and believing a wrong zero about their own video is
         * worse than seeing a dash.
         */
        view_count: v.view_count ?? null,
        like_count: v.like_count ?? null,
        comment_count: v.comment_count ?? null,
        share_count: v.share_count ?? null,
        fetched_at: new Date().toISOString(),
      }));

      const { error: upErr } = await admin
        .from('creator_tiktok_videos')
        .upsert(rows, { onConflict: 'creator_id,video_id' });
      if (upErr) return reply({ error: 'Could not save your video figures' }, 500);

      /*
       * AND FORGET WHAT TIKTOK NO LONGER RETURNS. Upserting alone meant a video
       * the creator deleted on TikTok kept its last known view count and sat at
       * the top of their list forever, because nothing ever removed it.
       *
       * Scoped to this creator AND to this page of results: only rows we did
       * not just see are dropped, so a second page arriving later cannot delete
       * the first.
       */
      await admin
        .from('creator_tiktok_videos')
        .delete()
        .eq('creator_id', creatorId)
        .not('video_id', 'in', `(${rows.map((r) => r.video_id).join(',')})`);
    }

    await admin
      .from('creator_tiktok_connections')
      .update({ last_synced_at: new Date().toISOString(), last_error: null })
      .eq('creator_id', creatorId);

    return reply({ ok: true, count: videos.length });
  } catch (e) {
    const message = (e as Error).message;
    await admin
      .from('creator_tiktok_connections')
      .update({ last_error: message })
      .eq('creator_id', creatorId);
    return reply({ error: 'TikTok could not be reached just now. Try again shortly.' }, 502);
  }
});
