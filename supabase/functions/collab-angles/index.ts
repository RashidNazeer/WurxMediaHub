/**
 * collab-angles
 * ---------------------------------------------------------------------------
 * The Categorise button on Paid Collabs -> Reporting -> Creative angle testing.
 *
 * Umar, 2026-10-06: "whenever I click the categorise/process button for a
 * certain brand its relevant brief and the new videos are sent to this
 * machine". Filing a month of videos into creative angles is done by hand
 * today: somebody watches each one and drops it into an angle. This queues
 * that work; `collab-angles-sync` does it, five videos at a time.
 *
 * TWO ACTIONS, both read-mostly:
 *   angles.start     queue this brand's unfiled videos for this month
 *   angles.progress  how far along, for the ring around the button
 *
 * AND THE QUEUE SCREEN (queue.*), for seeing what is waiting and editing it:
 *   queue.list         every video in the queue with every status (waiting, in
 *                      flight, failed, flagged for review, and the recent filed
 *                      and skipped history), grouped by brand and month, plus
 *                      why the worker is pausing if it is
 *   queue.remove       take chosen videos out of the queue
 *   queue.remove_group take a brand's month out of the queue
 *   queue.retry        put failed or flagged videos back, with fresh attempts
 *   queue.retry_group  the same for a whole brand and month
 *   queue.prioritise   make a brand's month the next one the worker picks up
 * None of them takes a video URL: they name rows by id, brand and month, so the
 * audit machine can still only ever be given links this function derived. A
 * video that is `sent` is at the audit machine right now and is never removed.
 *
 * THE VIDEO LIST IS DERIVED HERE, NOT SENT BY THE BROWSER. The audit machine
 * downloads whatever link it is given, so a list that came from the page would
 * let anyone holding a staff token point it at any URL on the internet. The
 * only input this trusts is a brand and a month.
 *
 * WHO CAN RUN IT: an active `ops`, `admin` or `ads_manager`. The screen also
 * hides the button unless the person has the vendored app's `canEditAngles`,
 * which is the same gate as New angle; this is the half that is enforced.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import { tiktokVideoId } from '../_shared/audit-api.ts';
import { filedVideoIds } from '../_shared/angle-store.ts';
import { cooldownLeft, isEnvError, ENV_MARK } from '../_shared/angle-backoff.ts';

const STAFF = ['ops', 'admin', 'ads_manager'];
const MONTH = /^\d{4}-\d{2}$/;

const Body = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('angles.start'),
    brand: z.string().trim().min(1).max(120),
    month: z.string().regex(MONTH, 'month must be YYYY-MM'),
  }),
  z.object({
    action: z.literal('angles.progress'),
    brand: z.string().trim().min(1).max(120),
    month: z.string().regex(MONTH, 'month must be YYYY-MM'),
  }),
  z.object({ action: z.literal('queue.list') }),
  z.object({
    action: z.literal('queue.remove'),
    ids: z.array(z.uuid()).min(1).max(200),
  }),
  z.object({
    action: z.literal('queue.retry'),
    ids: z.array(z.uuid()).min(1).max(200),
  }),
  z.object({
    action: z.literal('queue.remove_group'),
    brand: z.string().trim().min(1).max(120),
    month: z.string().regex(MONTH, 'month must be YYYY-MM'),
  }),
  z.object({
    action: z.literal('queue.retry_group'),
    brand: z.string().trim().min(1).max(120),
    month: z.string().regex(MONTH, 'month must be YYYY-MM'),
  }),
  z.object({
    action: z.literal('queue.prioritise'),
    brand: z.string().trim().min(1).max(120),
    month: z.string().regex(MONTH, 'month must be YYYY-MM'),
  }),
]);

/** A brief row, as the queue needs it. */
interface Brief {
  brand: string;
  aliases: string[] | null;
  product: string;
  brief_url: string;
  angles: string[] | null;
  position: number;
}

/** Does this brief belong to this brand, under any of its spellings? */
function briefMatches(b: Brief, brand: string): boolean {
  const want = brand.trim().toLowerCase();
  if ((b.brand ?? '').trim().toLowerCase() === want) return true;
  return (b.aliases ?? []).some((a) => (a ?? '').trim().toLowerCase() === want);
}

export interface QueueVideo {
  video_id: string;
  video_url: string;
  creator: string | null;
  month: string;
}

/**
 * This brand's videos for this month, out of the Paid Collabs creator rows.
 *
 * The month rule is the screen's own (`brandVideos` in angleStore.js): the
 * video's date when it has one, else the creator's hiring month, so a creator
 * signed in July who posts in August is testing an August angle. A video with
 * neither is not on the screen at all and cannot be filed, so it is counted
 * and skipped rather than guessed at.
 */
export function videosForBrand(
  creators: Array<Record<string, unknown>>,
  brand: string,
  month: string,
): { videos: QueueVideo[]; noDate: number } {
  const want = brand.trim();
  const byId = new Map<string, QueueVideo>();
  let noDate = 0;

  for (const c of creators) {
    if (String(c.brand ?? '').trim() !== want) continue;
    const hire = String(c.hiring_date ?? '').slice(0, 7);
    const codes = Array.isArray(c.video_codes) ? c.video_codes : [];
    for (const raw of codes) {
      const v = raw as Record<string, unknown> | null;
      const url = String(v?.video ?? '').trim();
      if (!url) continue;
      const vm = String(v?.date ?? '').slice(0, 7) || hire;
      if (!vm) {
        noDate += 1;
        continue;
      }
      if (vm !== month) continue;
      const id = tiktokVideoId(url);
      if (!id) {
        noDate += 1;
        continue;
      }
      /* The same video sits on two creator rows after a bulk paste. One entry
         wins, and it keeps the link spelling that row holds, because that is
         the string the screen will match when it draws the card. */
      if (!byId.has(id)) {
        byId.set(id, {
          video_id: id,
          video_url: url,
          creator: (String(c.name ?? '').trim() || null),
          month,
        });
      }
    }
  }
  return { videos: [...byId.values()], noDate };
}

/**
 * Everything both actions need to know about one brand month: its videos, how
 * many were undatable, and which video ids an angle already holds.
 *
 * The angle store is consulted so that videos already filed (usually by hand)
 * are never queued: each one would otherwise cost the audit machine about five
 * minutes, only to be discarded as a duplicate when it is filed. The store is
 * read with the brand exactly as given, because its key is case sensitive,
 * whereas the brief lookup is not; that difference is deliberate.
 */
async function monthOf(db: SupabaseClient, brand: string, month: string) {
  /* ONE BRAND'S ROWS, FILTERED IN THE DATABASE. Reading `wurxbase.creators`
     through PostgREST and filtering here came back SILENTLY TRUNCATED: the
     default cap is 1000 rows and there are 1479, so roughly 479 creators were
     invisible and any brand sitting past the cap had videos the button could
     never find. It was also 1.8 MB and about 2.7 seconds a call, which the
     progress poll asks for every five seconds.

     The function matches trimmed and case sensitively, exactly as the screen's
     own `brandVideos` does, so what this collects is what that brand's cards
     show. See 20261007140000_collab_brand_creator_videos.sql. */
  const { data: creators, error } = await db
    .rpc('collab_brand_creator_videos', { p_brand: brand });
  if (error) throw new Error(error.message);

  const { videos, noDate } = videosForBrand(
    ((creators ?? []) as Array<Record<string, unknown>>)
      /* The rpc has already matched the brand, and `videosForBrand` filters on
         it again; give it the value it expects rather than loosening it. */
      .map((c) => ({ ...c, brand })),
    brand,
    month,
  );
  /* Skip the store read when there is nothing to compare against. */
  const filed = videos.length ? await filedVideoIds(db, brand, month) : new Set<string>();
  return { videos, noDate, filed };
}

/* What the audit machine writes into `last_error` when the hosted model
   (Gemini) is the problem. `module_failed` is its word for a model call that
   did not complete, which on the free key is nearly always the 500 requests a
   day quota. It is also what every video said when the audit machine's own
   dependencies were broken, so the screen only says "most likely". */
const MODEL_TROUBLE =
  /module_failed|resource[_ ]exhausted|quota|gemini|model call|rate[ -]?limit|no visual evidence|angle judgement returned nothing|not judged against every brief/i;
/* Only RECENT failures count, so a month that failed weeks ago for reasons
   since fixed does not keep blaming the model. */
const MODEL_TROUBLE_WINDOW_MS = 24 * 60 * 60 * 1000;

type VideoRow = {
  status: string;
  attempts: number | null;
  last_error: string | null;
  updated_at: string | null;
};

/** The counts the screen draws, and how many videos are failing because of the model. */
function countProgress(rows: VideoRow[], now = Date.now()) {
  const counts = { queued: 0, sent: 0, filed: 0, skipped: 0, failed: 0, needs_review: 0 };
  let modelFailures = 0;
  for (const r of rows) {
    if (r.status in counts) counts[r.status as keyof typeof counts] += 1;
    /* Failed, or queued again after a failure: either way the model is not
       currently doing its job for this video. A queued video is judged by its
       `last_error` alone and NOT by `attempts`: the worker does not charge an
       attempt for a failure that is the environment's (a spent quota), so a
       video held back by the quota has attempts of zero. */
    const failing = r.status === 'failed' || r.status === 'queued';
    if (
      failing && r.last_error && MODEL_TROUBLE.test(r.last_error) &&
      now - Date.parse(r.updated_at ?? '') <= MODEL_TROUBLE_WINDOW_MS
    ) modelFailures += 1;
  }
  return { counts, modelFailures };
}

async function progressOf(db: SupabaseClient, brand: string, month: string) {
  const { videos, filed } = await monthOf(db, brand, month);

  const { data, error } = await db
    .from('collab_angle_videos')
    .select('status, attempts, last_error, updated_at')
    .eq('brand', brand)
    .eq('month', month);
  if (error) throw new Error(error.message);

  const { counts, modelFailures } = countProgress((data ?? []) as VideoRow[]);
  const total = (data ?? []).length;
  const left = counts.queued + counts.sent;

  const { data: batch } = await db
    .from('collab_angle_batches')
    .select('id, state, last_phase, n_videos, provider_job, error, last_polled_at')
    .eq('brand', brand)
    .eq('month', month)
    .in('state', ['submitting', 'running', 'filing'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  /* The audit machine's own progress for the running batch. Read apart from
     the query above so that a missing column (migration 20261029120000 not yet
     applied) costs the detail and nothing else. */
  let batchProgress: unknown = null;
  const batchId = (batch as { id?: string } | null)?.id;
  if (batchId) {
    const { data: pr } = await db.from('collab_angle_batches')
      .select('last_progress').eq('id', batchId).maybeSingle();
    batchProgress = (pr as { last_progress?: unknown } | null)?.last_progress ?? null;
  }
  /* Which batch this is out of how many, from the queue itself. */
  const batchesTotal = Math.max(1, Math.ceil(total / 5));
  const batchesDone = Math.min(batchesTotal, Math.floor((counts.filed + counts.skipped + counts.failed + counts.needs_review) / 5));

  /* A rough number, and the UI says so. Five and a half minutes a video is
     what a first run measured; a video the machine has seen before is far
     quicker, so this over-estimates rather than under-promises. */
  const eta = left > 0 ? Math.round(left * 5.5 * 60) : 0;

  return {
    total,
    ...counts,
    /* How many videos are failing for a reason that looks like the Gemini model
       (an outage or the daily quota). Additive: an older screen ignores it. */
    model_failures: modelFailures,
    running_batch: batch
      ? {
        state: (batch as { state: string }).state,
        last_phase: (batch as { last_phase: string | null }).last_phase,
        n_videos: (batch as { n_videos: number }).n_videos,
        progress: batchProgress,
        polled_at: (batch as { last_polled_at: string | null }).last_polled_at,
        batch_no: batchesDone + 1,
        batches: batchesTotal,
      }
      : null,
    /* About the brand month as a whole, not the queue: `total` above is what the
       ring is drawn from, these two are what the screen compares to decide
       whether everything is done. Computed by the same code as angles.start so
       the two can never disagree. */
    total_videos: videos.length,
    already_categorised: videos.filter((v) => filed.has(v.video_id)).length,
    eta_seconds: eta,
  };
}

/* ── the queue screen ─────────────────────────────────────────────────────── */

type Actor = { id: string; email: string | null; role: string | null };

/* A video that is `sent` is in a batch at the audit machine and the worker is
   about to file it, so it is never removed or re-queued from here. `filed` and
   `skipped` are the record of what already happened: they are LISTED, so the
   screen can show every status, but they cannot be removed or retried. */
const REMOVABLE = ['queued', 'failed', 'needs_review'];
const RETRYABLE = ['failed', 'needs_review'];
const PENDING = ['queued', 'sent', 'failed', 'needs_review'];
const DONE = ['filed', 'skipped'];
/* PostgREST's own cap is 1000 rows. A queue bigger than that says so. */
const LIST_LIMIT = 1000;
/* The history is only ever the most recent part. It is fetched on its own so a
   long run of filed videos can never push waiting ones off the end of the list. */
const DONE_LIMIT = 400;

async function audit(db: SupabaseClient, actor: Actor, action: string, detail: Record<string, unknown>) {
  await db.from('audit_log').insert({
    actor_id: actor.id,
    actor_email: actor.email,
    actor_role: actor.role,
    action,
    subject_type: 'collab_angle_queue',
    detail,
  });
}

async function listQueue(db: SupabaseClient) {
  const COLUMNS =
    'id, brand, month, video_id, video_url, creator, status, attempts, last_error, angle, created_at, updated_at';
  const { data, error } = await db
    .from('collab_angle_videos')
    .select(COLUMNS)
    .in('status', PENDING)
    .order('created_at', { ascending: true })
    .limit(LIST_LIMIT);
  if (error) throw new Error(error.message);
  const pending = (data ?? []) as Array<Record<string, unknown>>;

  const { data: doneData, error: doneErr } = await db
    .from('collab_angle_videos')
    .select(COLUMNS)
    .in('status', DONE)
    .order('updated_at', { ascending: false })
    .limit(DONE_LIMIT);
  if (doneErr) throw new Error(doneErr.message);
  const done = (doneData ?? []) as Array<Record<string, unknown>>;

  /* Exact totals for the history, which the list above only samples. */
  const exact: Record<string, number> = {};
  for (const s of DONE) {
    const { count } = await db.from('collab_angle_videos')
      .select('id', { count: 'exact', head: true }).eq('status', s);
    exact[s] = count ?? 0;
  }
  const rows = [...pending, ...done];

  /* One group per brand and month, in the order the worker will take them: the
     oldest WAITING video decides it. A group with nothing waiting (only failed,
     flagged or finished videos) has no place in that order and goes after the
     rest. */
  const groups = new Map<string, {
    brand: string;
    month: string;
    counts: Record<string, number>;
    next_at: string | null;
    videos: Array<Record<string, unknown>>;
  }>();
  for (const r of rows) {
    const key = `${r.brand}|${r.month}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        brand: String(r.brand),
        month: String(r.month),
        counts: { queued: 0, sent: 0, failed: 0, needs_review: 0, filed: 0, skipped: 0 },
        next_at: null,
        videos: [],
      };
      groups.set(key, g);
    }
    const st = String(r.status);
    g.counts[st] = (g.counts[st] ?? 0) + 1;
    if (st === 'queued' && !g.next_at) g.next_at = String(r.created_at);
    g.videos.push({
      id: r.id,
      video_id: r.video_id,
      video_url: r.video_url,
      creator: r.creator,
      status: st,
      attempts: r.attempts ?? 0,
      last_error: r.last_error ?? null,
      angle: r.angle ?? null,
    });
  }
  const ordered = [...groups.values()].sort((a, b) => {
    if (a.next_at && b.next_at) return a.next_at < b.next_at ? -1 : 1;
    if (a.next_at) return -1;
    if (b.next_at) return 1;
    return `${a.brand}|${a.month}`.localeCompare(`${b.brand}|${b.month}`);
  });

  const totals = { queued: 0, sent: 0, failed: 0, needs_review: 0, filed: 0, skipped: 0 };
  for (const g of ordered) {
    for (const k of PENDING) totals[k as keyof typeof totals] += g.counts[k] ?? 0;
  }
  /* The history is counted exactly, not from the sample. */
  totals.filed = exact.filed ?? 0;
  totals.skipped = exact.skipped ?? 0;

  /* WHY NOTHING IS MOVING, when the worker is deliberately waiting. It is the
     same test the worker applies before making a batch, so the screen and the
     worker cannot disagree. */
  const { data: finished } = await db
    .from('collab_angle_batches')
    .select('finished_at, error')
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(10);
  const batches = (finished ?? []) as Array<{ finished_at: string | null; error: string | null }>;
  const wait = cooldownLeft(batches);
  const lastEnv = batches[0]?.error;

  return {
    groups: ordered,
    totals,
    truncated: pending.length >= LIST_LIMIT,
    /* Only the latest finished videos are listed; the totals above are exact. */
    history_truncated: totals.filed + totals.skipped > done.length,
    wait_seconds: Math.ceil(wait / 1000),
    wait_reason: wait > 0 && isEnvError(lastEnv)
      ? String(lastEnv).slice(ENV_MARK.length).trim().slice(0, 300)
      : null,
  };
}

async function queueAction(db: SupabaseClient, actor: Actor, body: z.infer<typeof Body>) {
  switch (body.action) {
    case 'queue.list':
      return { ok: true, ...(await listQueue(db)) };

    case 'queue.remove': {
      const { data, error } = await db.from('collab_angle_videos').delete()
        .in('id', body.ids).in('status', REMOVABLE).select('id, brand, month');
      if (error) throw new Error(error.message);
      const removed = (data ?? []).length;
      await audit(db, actor, 'collab_angles.queue_remove', { asked: body.ids.length, removed });
      return { ok: true, removed, skipped: body.ids.length - removed };
    }

    case 'queue.remove_group': {
      const { data, error } = await db.from('collab_angle_videos').delete()
        .eq('brand', body.brand).eq('month', body.month).in('status', REMOVABLE).select('id');
      if (error) throw new Error(error.message);
      const removed = (data ?? []).length;
      await audit(db, actor, 'collab_angles.queue_remove_group', {
        brand: body.brand,
        month: body.month,
        removed,
      });
      return { ok: true, removed };
    }

    case 'queue.retry':
    case 'queue.retry_group': {
      /* Fresh attempts, so a video that failed three times gets three more
         tries rather than failing again on the first. It keeps its place in
         its brand's line, because its created_at is left alone. */
      let q = db.from('collab_angle_videos')
        .update({ status: 'queued', attempts: 0, last_error: null, batch_id: null })
        .in('status', RETRYABLE);
      q = body.action === 'queue.retry'
        ? q.in('id', body.ids)
        : q.eq('brand', body.brand).eq('month', body.month);
      const { data, error } = await q.select('id');
      if (error) throw new Error(error.message);
      const retried = (data ?? []).length;
      await audit(
        db,
        actor,
        body.action === 'queue.retry' ? 'collab_angles.queue_retry' : 'collab_angles.queue_retry_group',
        body.action === 'queue.retry'
          ? { asked: body.ids.length, retried }
          : { brand: body.brand, month: body.month, retried },
      );
      return { ok: true, retried };
    }

    case 'queue.prioritise': {
      /* The worker takes the oldest waiting video's brand and month, so "next"
         is "older than everything else that is waiting". One second is enough:
         ordering is all that is read from this column. */
      const { data: first } = await db.from('collab_angle_videos').select('created_at')
        .eq('status', 'queued').order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!first) return { ok: false, error: 'Nothing is waiting in the queue.' };
      const ts = new Date(Date.parse((first as { created_at: string }).created_at) - 1000).toISOString();
      const { data, error } = await db.from('collab_angle_videos').update({ created_at: ts })
        .eq('brand', body.brand).eq('month', body.month).eq('status', 'queued').select('id');
      if (error) throw new Error(error.message);
      const moved = (data ?? []).length;
      if (!moved) return { ok: false, error: `${body.brand} has nothing waiting for that month.` };
      await audit(db, actor, 'collab_angles.queue_prioritise', {
        brand: body.brand,
        month: body.month,
        moved,
      });
      return { ok: true, moved };
    }

    default:
      throw new Error('not a queue action');
  }
}

Deno.serve(async (req) => {
  const reply = (body: unknown, status = 200) => json(body, status, req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return reply({ error: 'Not signed in' }, 401);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  /* Verified against the auth server, never decoded from the token. */
  const { data: userData, error: userErr } = await admin.auth.getUser(
    authHeader.replace(/^Bearer\s+/i, ''),
  );
  if (userErr || !userData?.user) return reply({ error: 'Not signed in' }, 401);

  const { data: actor } = await admin
    .from('profiles')
    .select('id, email, role, is_active')
    .eq('id', userData.user.id)
    .single();

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return reply({ error: 'Send a JSON body' }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return reply({ error: parsed.error.issues[0]?.message ?? 'Bad request' }, 400);
  }
  const body = parsed.data;

  if (!actor?.is_active || !STAFF.includes(String(actor?.role))) {
    await admin.from('audit_log').insert({
      actor_id: actor?.id ?? null,
      actor_email: actor?.email ?? null,
      actor_role: actor?.role ?? null,
      action: 'collab_angles.write_denied',
      subject_type: 'brand',
      detail: {
        brand: 'brand' in body ? body.brand : null,
        month: 'month' in body ? body.month : null,
        wanted: body.action,
      },
    });
    return reply({ error: 'Not allowed' }, 403);
  }

  try {
    /* THE QUEUE ACTIONS ARE ANSWERED FIRST, AND INSIDE THE try, because most of
       them carry no brand at all. This used to come after `body.brand.trim()`,
       which threw a TypeError on every queue.list and queue.remove OUTSIDE any
       error handling: the platform then answered with a bare 500 that has no CORS
       headers, which a browser reports as "the service did not answer". */
    if (body.action.startsWith('queue.')) {
      const res = await queueAction(admin, actor, body);
      return reply(res, (res as { ok?: boolean }).ok === false ? 422 : 200);
    }

    /* From here on the action is angles.start or angles.progress, and both carry
       a brand and a month. */
    if (!('brand' in body)) return reply({ error: 'Which brand?' }, 400);
    const brand = body.brand.trim();

    if (body.action === 'angles.progress') {
      return reply({ ok: true, ...(await progressOf(admin, brand, body.month)) });
    }

    /* ── angles.start ──────────────────────────────────────────────────── */
    const { data: briefRows, error: briefErr } = await admin
      .from('collab_brand_briefs')
      .select('brand, aliases, product, brief_url, angles, position')
      .eq('is_active', true);
    if (briefErr) throw new Error(briefErr.message);

    const briefs = ((briefRows ?? []) as Brief[]).filter((b) => briefMatches(b, brand));
    if (!briefs.length) {
      return reply({
        error: `${brand} has no content brief on file, so its videos cannot be ` +
          `categorised. Add one to collab_brand_briefs first.`,
      }, 422);
    }

    const { videos, noDate, filed } = await monthOf(admin, brand, body.month);

    if (!videos.length) {
      return reply({
        ok: true,
        total_videos: 0,
        queued: 0,
        already_categorised: 0,
        already_queued: 0,
        skipped_no_date: noDate,
        brand,
        month: body.month,
        briefs: briefs.length,
      });
    }

    /* Rows already in the queue for this brand and month, whatever their
       status: a video that failed or was skipped is not queued again by a
       second press of the button, it is left as it is. */
    const { data: existing, error: exErr } = await admin
      .from('collab_angle_videos')
      .select('video_id')
      .eq('brand', brand)
      .eq('month', body.month);
    if (exErr) throw new Error(exErr.message);
    const known = new Set((existing ?? []).map((r) => String((r as { video_id: string }).video_id)));

    /* Sort every video into exactly one bucket, and test "already filed"
       FIRST. A video that is both filed and queued (the queue row is still
       there from an earlier run, and somebody has since filed it by hand, or the
       worker did) is counted once, as categorised. Counting it in both would
       make the three numbers add up to more than total_videos, and the screen
       compares them to decide whether to say "all categorised". */
    const alreadyCategorised = videos.filter((v) => filed.has(v.video_id));
    const unfiled = videos.filter((v) => !filed.has(v.video_id));
    const fresh = unfiled.filter((v) => !known.has(v.video_id));
    const alreadyQueued = unfiled.length - fresh.length;

    if (fresh.length) {
      const { error: insErr } = await admin.from('collab_angle_videos').insert(
        fresh.map((v) => ({
          brand,
          month: body.month,
          video_id: v.video_id,
          video_url: v.video_url,
          creator: v.creator,
          status: 'queued',
        })),
      );
      if (insErr) throw new Error(insErr.message);
    }

    await admin.from('audit_log').insert({
      actor_id: actor.id,
      actor_email: actor.email,
      actor_role: actor.role,
      action: 'collab_angles.start',
      subject_type: 'brand',
      detail: {
        brand,
        month: body.month,
        total_videos: videos.length,
        queued: fresh.length,
        already_categorised: alreadyCategorised.length,
        already_queued: alreadyQueued,
        skipped_no_date: noDate,
        briefs: briefs.length,
      },
    });

    return reply({
      ok: true,
      total_videos: videos.length,
      queued: fresh.length,
      already_categorised: alreadyCategorised.length,
      already_queued: alreadyQueued,
      skipped_no_date: noDate,
      brand,
      month: body.month,
      briefs: briefs.length,
    });
  } catch (err) {
    console.error('collab-angles failed', body.action, err);
    return reply({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
