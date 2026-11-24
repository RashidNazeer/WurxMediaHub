/**
 * sync-creator-avatars
 * ---------------------------------------------------------------------------
 * Fetches each creator's TikTok profile picture ONCE and keeps it in our own
 * storage, so the admin screens never ask a third party for anything.
 *
 * WHY IT EXISTS. The vendored WurxBase draws real faces by asking unavatar.io
 * from the BROWSER, per row, on every page view. That works and it costs three
 * things: every creator's handle leaves our domain each time a screen opens,
 * long lists get rate limited (their own code carries a `noRemote` flag because
 * the Discovery tab hit 429s and sat on blank circles), and the day unavatar
 * blocks us every face in the product turns back into a letter. Rashid asked
 * for it on our end instead.
 *
 * SO THIS IS THE ONLY THING THAT EVER TALKS TO UNAVATAR, it runs on Supabase's
 * servers rather than in anybody's browser, and it runs once per creator.
 *
 * ADMIN ONLY. The caller must be active staff, re-read from the profiles TABLE
 * rather than from a JWT claim, for the same reason as every other function
 * here: a role in a token can be an hour out of date.
 *
 * WHAT IT WILL NOT DO:
 *   - follow a redirect to somewhere that is not an image
 *   - accept anything that is not png, jpeg or webp, whatever it claims
 *   - accept more than 2 MB
 *   - retry a creator it has already tried, unless asked to refresh
 *   - fetch more than `limit` in one run, so a bug cannot become a thousand
 *     outbound requests
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';

const BUCKET = 'creator-avatars';

/** 2 MB, matching the bucket's own limit. */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * What we are willing to store. An SVG is a script host and has no business in
 * a bucket, which is why it is absent here as well as from the bucket itself.
 */
const ALLOWED = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);

const Body = z.object({
  /**
   * How many to fetch this run. The ceiling is the point: it is the backstop
   * against a bug turning into hundreds of outbound requests, and it keeps a
   * run inside the function's own time limit.
   */
  limit: z.number().int().min(1).max(100).default(25),
  /** Re-fetch creators we have already tried. Off by default. */
  refresh: z.boolean().default(false),
  /** Just these handles, for fixing one person rather than sweeping. */
  handles: z.array(z.string().trim().min(2).max(64)).max(100).optional(),
});

Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) => json(body, status, req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Not signed in' }, 401);

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
  if (actorErr || !actor || !actor.is_active) return reply({ error: 'Not allowed' }, 403);
  // Ads Manager is staff since 2026-09-15, the same as ops. Mirrors is_staff().
  if (actor.role !== 'admin' && actor.role !== 'ops' && actor.role !== 'ads_manager' && actor.role !== 'ops_lead') {
    return reply({ error: 'Only the team can do that' }, 403);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return reply({ error: parsed.error.issues[0]?.message ?? 'Bad request' }, 400);
  }
  const { limit, refresh, handles } = parsed.data;

  /* ------------------------------------------------------------ who to do -- */
  let query = admin
    .from('creator_avatar_queue')
    .select('profile_id, display_name, tiktok_handle, path, error');

  if (handles?.length) query = query.in('tiktok_handle', handles);
  // Not `refresh`: leave the ones already answered alone. `path is null` alone
  // would keep retrying the ones we know have no picture, every single run.
  else if (!refresh) query = query.is('fetched_at', null);

  const { data: queue, error: queueErr } = await query.limit(limit);
  if (queueErr) return reply({ error: `Could not read the queue: ${queueErr.message}` }, 500);

  const summary = {
    considered: queue?.length ?? 0,
    stored: 0,
    missing: 0,
    failed: 0,
    bytes: 0,
    results: [] as { handle: string; ok: boolean; note: string }[],
  };

  for (const person of queue ?? []) {
    const handle = String(person.tiktok_handle ?? '').replace(/^@/, '').trim();
    if (!handle) continue;

    let note = '';
    let ok = false;
    let path: string | null = null;
    let bytes: number | null = null;

    try {
      /*
       * `fallback=false` matters: without it unavatar returns a generated
       * placeholder for a handle it cannot resolve, and we would store a
       * picture of nobody and never look again.
       */
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let res: Response;
      try {
        res = await fetch(`https://unavatar.io/tiktok/${encodeURIComponent(handle)}?fallback=false`, {
          signal: controller.signal,
          redirect: 'follow',
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        note = `unavatar returned ${res.status}`;
      } else {
        const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
        const ext = ALLOWED.get(type);
        if (!ext) {
          // Whatever came back, it is not an image we are willing to keep.
          note = `not an image we accept (${type || 'no content type'})`;
        } else {
          const buffer = new Uint8Array(await res.arrayBuffer());
          if (buffer.byteLength === 0) {
            note = 'empty response';
          } else if (buffer.byteLength > MAX_BYTES) {
            note = `${Math.round(buffer.byteLength / 1024)}KB is over the 2MB limit`;
          } else {
            /*
             * Named by profile id, not by handle. The id is stable across a
             * rename, and it means the object name never says whose face it is
             * to anybody who has not already been told.
             */
            const objectName = `${person.profile_id}.${ext}`;
            const { error: upErr } = await admin.storage
              .from(BUCKET)
              .upload(objectName, buffer, { contentType: type, upsert: true });
            if (upErr) {
              note = `could not store it: ${upErr.message}`;
            } else {
              path = objectName;
              bytes = buffer.byteLength;
              ok = true;
              note = `${Math.round(buffer.byteLength / 1024)}KB`;
            }
          }
        }
      }
    } catch (e) {
      note = e instanceof Error ? e.message : 'fetch failed';
    }

    const { error: rowErr } = await admin.from('creator_avatars').upsert(
      {
        profile_id: person.profile_id,
        handle,
        path,
        source: 'unavatar',
        bytes,
        fetched_at: new Date().toISOString(),
        // The constraint insists on one or the other, so a row always explains
        // itself rather than sitting there empty and inviting a retry.
        error: path ? null : note || 'no picture found',
      },
      { onConflict: 'profile_id' }
    );
    if (rowErr) {
      summary.failed++;
      summary.results.push({ handle, ok: false, note: `row: ${rowErr.message}` });
      continue;
    }

    if (ok) {
      summary.stored++;
      summary.bytes += bytes ?? 0;
    } else {
      summary.missing++;
    }
    summary.results.push({ handle, ok, note });
  }

  await admin.from('audit_log').insert({
    actor_id: actor.id,
    actor_email: actor.email,
    actor_role: actor.role,
    action: 'creator_avatars.synced',
    subject_type: 'creator_avatars',
    detail: {
      considered: summary.considered,
      stored: summary.stored,
      missing: summary.missing,
      failed: summary.failed,
      refresh,
    },
  });

  return reply({ ok: true, ...summary });
});
