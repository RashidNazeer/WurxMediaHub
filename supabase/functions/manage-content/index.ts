/**
 * manage-content
 * ---------------------------------------------------------------------------
 * A creator posting the videos they filmed, and staff deciding on them.
 *
 * The second door both sides use, so the role check is per action rather than
 * one gate at the top:
 *
 *   content.create   an active creator, and only against their own job
 *   content.update   the creator who posted it, and only while it is unapproved
 *   content.delete   the same
 *   content.review   active staff
 *
 * Identity comes from the profiles TABLE, never from the body and never from a
 * JWT claim, for the same reason as everywhere else: a creator approved five
 * minutes ago still carries `applicant` in their token.
 *
 * `content_submissions` has no insert, update or delete policy. The database
 * functions are granted to `service_role` alone. This is the only way a row
 * gets written.
 *
 * The one thing this function does that its siblings do not is reach OUT: it
 * asks the platform's own oEmbed for a thumbnail and a title. That happens
 * here rather than in the browser so a creator's session is never spent on a
 * third party, and so a slow or hostile response cannot hold up their upload.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';

const VideoUrl = z
  .string()
  .trim()
  .min(12)
  .max(2048)
  .refine((v) => /^https:\/\//i.test(v), 'A video link has to start with https://');

const AdCode = z
  .string()
  .trim()
  .min(3, 'That ad code looks too short')
  .max(120, 'That ad code looks too long');

const CreateBody = z.object({
  action: z.literal('content.create'),
  applicationId: z.uuid('Which job is this for?'),
  videoUrl: VideoUrl,
  adCode: AdCode,
  adAuthorized: z.boolean().default(false),
});

const UpdateBody = z.object({
  action: z.literal('content.update'),
  contentId: z.uuid(),
  videoUrl: VideoUrl,
  adCode: AdCode,
  adAuthorized: z.boolean().default(false),
});

const DeleteBody = z.object({
  action: z.literal('content.delete'),
  contentId: z.uuid(),
});

const ReviewBody = z.object({
  action: z.literal('content.review'),
  contentId: z.uuid(),
  status: z.enum(['approved', 'needs_another_take']),
  note: z.string().trim().max(500).nullish(),
});

/**
 * Re-fetching a thumbnail whose signature has expired.
 *
 * Same origin on purpose. TikTok omits its CORS headers on error responses,
 * so a browser asking directly logs a CORS violation for every deleted post,
 * and this product does not ship console errors.
 */
const RefreshBody = z.object({
  action: z.literal('content.refresh'),
  contentId: z.uuid(),
});

const Body = z.discriminatedUnion('action', [
  CreateBody,
  UpdateBody,
  DeleteBody,
  ReviewBody,
  RefreshBody,
]);

const STATUS_FOR_PG: Record<string, number> = {
  '42501': 403,
  P0002: 404,
  '22023': 400,
  '23503': 409,
  '23505': 409,
  '23514': 400,
};

function humanise(message: string, code: string | undefined): string {
  if (code === '23505') return 'You have already posted that link for this job';
  if (code === '23514') return 'One of those values is outside what we allow';
  return message;
}

/* -------------------------------------------------------------- oEmbed --- */

interface Preview {
  thumbnail_url: string | null;
  video_title: string | null;
  video_author: string | null;
  embed_id: string | null;
}

const EMPTY: Preview = {
  thumbnail_url: null,
  video_title: null,
  video_author: null,
  embed_id: null,
};

/**
 * Ask the platform what this link is.
 *
 * Best effort, always. Every field on the row is nullable and the card falls
 * back to a plain design without a thumbnail, because TikTok having a bad
 * minute must never be the reason a creator cannot log the work they did.
 *
 * Nine seconds, then we give up and take the link as it stands. Five was not
 * enough: the first call after a deploy is cold, and Deno pulling its npm
 * dependencies ate the budget before the fetch had started.
 */
async function preview(rawUrl: string): Promise<Preview> {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return EMPTY;
  }
  // Only TikTok has an endpoint we trust here. Anything else is stored as a
  // plain link rather than fetched, which also stops this being a way to make
  // our server request arbitrary hosts.
  if (!/(^|\.)tiktok\.com$/.test(host)) return EMPTY;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(rawUrl)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return EMPTY;
    const data = (await res.json()) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

    return {
      thumbnail_url: str(data.thumbnail_url),
      video_title: str(data.title),
      video_author: str(data.author_name),
      embed_id: str(data.embed_product_id) ?? rawUrl.match(/\/video\/(\d+)/)?.[1] ?? null,
    };
  } catch {
    return EMPTY;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- serve --- */

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

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply({ error: 'Expected a JSON body' }, 400);
  }

  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return reply(
      { error: parsed.error.issues[0]?.message ?? 'That request was not valid' },
      400
    );
  }
  const input = parsed.data;

  // ------------------------------------------------------------- the gate --
  // Ads Manager is staff since 2026-09-15, the same as ops. Mirrors is_staff().
  const isStaff = actor.role === 'admin' || actor.role === 'ops' || actor.role === 'ads_manager' || actor.role === 'ops_lead';
  const isCreator = actor.role === 'creator';
  const needsStaff = input.action === 'content.review';
  const anyone = input.action === 'content.refresh';

  if (!anyone && ((needsStaff && !isStaff) || (!needsStaff && !isCreator))) {
    await admin.from('audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'content.write_denied',
      subject_type: 'content_submission',
      detail: { reason: needsStaff ? 'not staff' : 'not a creator', attempted: input.action },
    });
    return reply({ error: 'Not allowed' }, 403);
  }

  // ---------------------------------------------------------------- do it --
  let rpc: { data: unknown; error: { message?: string; code?: string } | null };

  if (input.action === 'content.create') {
    const meta = await preview(input.videoUrl);
    rpc = await admin.rpc('submit_content', {
      p_actor_id: actor.id,
      p_application_id: input.applicationId,
      p_video_url: input.videoUrl,
      p_ad_code: input.adCode,
      p_ad_authorized: input.adAuthorized,
      p_thumbnail_url: meta.thumbnail_url,
      p_video_title: meta.video_title,
      p_video_author: meta.video_author,
      p_embed_id: meta.embed_id,
    });
  } else if (input.action === 'content.update') {
    const meta = await preview(input.videoUrl);
    rpc = await admin.rpc('update_content', {
      p_actor_id: actor.id,
      p_content_id: input.contentId,
      p_video_url: input.videoUrl,
      p_ad_code: input.adCode,
      p_ad_authorized: input.adAuthorized,
      p_thumbnail_url: meta.thumbnail_url,
      p_video_title: meta.video_title,
      p_video_author: meta.video_author,
      p_embed_id: meta.embed_id,
    });
  } else if (input.action === 'content.delete') {
    rpc = await admin.rpc('delete_content', {
      p_actor_id: actor.id,
      p_content_id: input.contentId,
    });
  } else if (input.action === 'content.refresh') {
    const { data: row } = await admin
      .from('content_submissions')
      .select('video_url')
      .eq('id', input.contentId)
      .single();
    if (!row) return reply({ error: 'No such submission' }, 404);
    const meta = await preview(row.video_url);
    if (!meta.thumbnail_url) return reply({ result: null });
    rpc = await admin.rpc('refresh_content_preview', {
      p_actor_id: actor.id,
      p_content_id: input.contentId,
      p_thumbnail_url: meta.thumbnail_url,
      p_video_title: meta.video_title,
      p_video_author: meta.video_author,
      p_embed_id: meta.embed_id,
    });
  } else {
    rpc = await admin.rpc('review_content', {
      p_actor_id: actor.id,
      p_content_id: input.contentId,
      p_status: input.status,
      p_note: input.note ?? null,
    });
  }

  if (rpc.error) {
    const code = rpc.error.code;
    return reply(
      { error: humanise(rpc.error.message ?? 'That did not go through', code) },
      STATUS_FOR_PG[code ?? ''] ?? 400
    );
  }

  return reply({ result: rpc.data });
});
