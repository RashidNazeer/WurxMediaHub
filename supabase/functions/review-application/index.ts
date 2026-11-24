/**
 * review-application
 * ---------------------------------------------------------------------------
 * Approve or reject creator applications, one or many.
 *
 * This is the only route to a decision. Row level security already stops an
 * applicant editing their own status, and the database function is granted to
 * `service_role` alone, so nothing reachable from a browser can approve anyone.
 * This function is the piece that decides WHO is allowed to ask.
 *
 * The order matters:
 *
 *   1. Verify the access token with the auth server. Not decode it. A JWT is
 *      signed, but this code never gets to be the thing that trusts a
 *      signature it did not check.
 *   2. Read the caller's role FROM THE PROFILES TABLE, not from the token's
 *      claims. Claims can be up to an hour stale, so an admin who was
 *      suspended five minutes ago is still carrying an admin claim right now.
 *      The table is the truth.
 *   3. Validate the body with Zod, again, even though the browser already did.
 *   4. Hand each decision to one Postgres function so status, role, tier and
 *      the audit row commit together or not at all.
 *
 * Bulk is a loop over that same function, NOT a bulk SQL statement. Each
 * application is still its own transaction with its own audit row, so one bad
 * item cannot roll back nine good ones and cannot slip through unlogged. The
 * role check happens once, before any of them.
 *
 * A signed-in user who is not staff and tries anyway gets a 403 and a row in
 * audit_log with their name on it.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';

const TIERS = ['creator', 'rising', 'pro', 'elite'] as const;

/** Bounded so one request can never become an unbounded pile of work. */
const MAX_BATCH = 100;

const ReviewBody = z
  .object({
    applicationId: z.uuid('applicationId must be a UUID').optional(),
    applicationIds: z
      .array(z.uuid('applicationIds must all be UUIDs'))
      .min(1, 'Select at least one application')
      .max(MAX_BATCH, `No more than ${MAX_BATCH} at a time`)
      .optional(),
    decision: z.enum(['approved', 'rejected']),
    tier: z.enum(TIERS).nullish(),
    note: z.string().trim().max(1000, 'Keep the note under 1000 characters').nullish(),
  })
  .refine((v) => Boolean(v.applicationId) || Boolean(v.applicationIds?.length), {
    message: 'Name at least one application',
    path: ['applicationIds'],
  })
  .refine((v) => v.decision !== 'approved' || Boolean(v.tier), {
    message: 'A tier is required when approving',
    path: ['tier'],
  })
  .refine((v) => v.decision !== 'rejected' || !v.tier, {
    message: 'A tier cannot be set when rejecting',
    path: ['tier'],
  });

/** SQLSTATE from the database function to something HTTP-shaped. */
const STATUS_FOR_PG: Record<string, number> = {
  '42501': 403, // insufficient privilege
  P0002: 404, // no data found
  '55006': 409, // object in use, our "already reviewed"
  '22023': 400, // invalid parameter value
};

const cleanMessage = (m: string | undefined) =>
  (m ?? 'Something went wrong').replace(/^review_application:\s*/, '');

Deno.serve(async (req) => {
  // Every response below carries the CORS headers. Miss one and the browser
  // discards the body, leaving a reviewer staring at a button that "does
  // nothing" while the server thinks it answered fine.
  const reply = (body: unknown, status = 200) => json(body, status, req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) {
    return reply({ error: 'Not signed in' }, 401);
  }

  // ---------------------------------------------------------- who is this --
  // Anon key plus the caller's token. getUser() asks the auth server, so an
  // expired, revoked or hand-crafted token fails here.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData?.user) {
    return reply({ error: 'Not signed in' }, 401);
  }
  const caller = userData.user;

  // Service role from here on. Nothing above this line was trusted.
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: actor, error: actorErr } = await admin
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('id', caller.id)
    .single();

  if (actorErr || !actor) {
    return reply({ error: 'Not allowed' }, 403);
  }

  // Ads Manager is staff since 2026-09-15, the same as ops. Mirrors is_staff().
  const isStaff = actor.role === 'admin' || actor.role === 'ops' || actor.role === 'ads_manager' || actor.role === 'ops_lead';

  if (!isStaff || !actor.is_active) {
    // A real account asking for something it is not entitled to. Worth keeping.
    await admin.from('audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'application.review_denied',
      subject_type: 'application',
      detail: { reason: actor.is_active ? 'not staff' : 'account inactive' },
    });
    return reply({ error: 'Not allowed' }, 403);
  }

  // ------------------------------------------------------------ the input --
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply({ error: 'Expected a JSON body' }, 400);
  }

  const parsed = ReviewBody.safeParse(raw);
  if (!parsed.success) {
    return reply(
      { error: parsed.error.issues[0]?.message ?? 'That request was not valid' },
      400
    );
  }
  const { applicationId, applicationIds, decision, tier, note } = parsed.data;

  // Duplicates in a selection are a UI slip, not an instruction to review the
  // same person twice; the second attempt would fail as "already reviewed" and
  // read as a real error.
  const ids = [...new Set(applicationIds ?? [applicationId!])];
  const single = ids.length === 1;

  // ------------------------------------------------------------ do it -----
  // Sequential on purpose. These take row locks, and a burst of parallel calls
  // against the same table buys nothing at this size except lock contention.
  const results: Array<{
    applicationId: string;
    ok: boolean;
    result?: unknown;
    error?: string;
    status?: number;
  }> = [];

  for (const id of ids) {
    const { data, error } = await admin.rpc('review_application', {
      p_application_id: id,
      p_decision: decision,
      p_actor_id: actor.id,
      p_tier: decision === 'approved' ? tier : null,
      p_note: note ?? null,
    });

    if (error) {
      const status = STATUS_FOR_PG[error.code ?? ''] ?? 500;
      if (status === 500) console.error('review_application failed', id, error);
      results.push({
        applicationId: id,
        ok: false,
        error: cleanMessage(error.message),
        status,
      });
    } else {
      results.push({ applicationId: id, ok: true, result: data });
    }
  }

  const succeeded = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);

  // One application behaves exactly as it always has, so a caller reviewing a
  // single person still gets a real HTTP status: 409 for "already reviewed",
  // 404 for a missing row. A batch answers 200 and reports per item, because
  // "nine worked, one did not" is not a single status code.
  if (single) {
    const only = results[0]!;
    if (!only.ok) return reply({ error: only.error }, only.status ?? 500);
    return reply({ ok: true, result: only.result, results }, 200);
  }

  return reply(
    {
      ok: failed.length === 0,
      reviewed: succeeded.length,
      failed: failed.length,
      result: succeeded[0]?.result ?? null,
      results,
    },
    200
  );
});
