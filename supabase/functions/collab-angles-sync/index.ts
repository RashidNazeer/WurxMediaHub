/**
 * collab-angles-sync
 * ---------------------------------------------------------------------------
 * The worker behind the Categorise button. pg_cron fires it every minute
 * (`collab_angles_run_cycle`); one tick does one small thing and returns.
 *
 * WHY A STATE MACHINE AND NOT A LOOP. The audit machine takes about five
 * minutes a video and runs one job at a time, so a batch of five is twenty-five
 * to thirty minutes. A function invocation has about a hundred seconds, and the
 * scheduler's own call gives up at two. Nothing can wait for a batch, so a
 * batch is a ROW, its state is in the database, and each tick moves it one
 * step:
 *
 *   (queued videos)  -> make a batch, submit it            -> running
 *   running          -> ask the machine; not finished yet  -> running
 *   running          -> finished: file every placement     -> done
 *
 * A TICK HOLDS A LEASE so two of them never work the same batch. The claim is
 * a conditional update rather than a lock: the loser's `lease_until` predicate
 * simply does not match, which needs no row locking and cannot leak a lock if
 * the function dies mid-flight.
 *
 * OFFLINE IS NOT FAILURE. The machine is a PC behind a tunnel. When it is
 * asleep the tunnel answers with its own HTML, and that must not spend a
 * retry, fail a batch, or resubmit a job that is still running over there.
 * See `_shared/audit-api.ts`, which is where those three cases are told apart.
 *
 * WHO CAN RUN IT: the scheduler presenting `x-sync-secret`, or an active
 * `ops`, `admin` or `ads_manager` for a manual kick.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  AuditOffline,
  AuditRefused,
  auditCreds,
  type BriefRef,
  canonicalVideoUrl,
  findJobByLabel,
  isMissingJob,
  jobState,
  submitJob,
  tiktokVideoId,
} from '../_shared/audit-api.ts';
import { filePlacements } from '../_shared/angle-store.ts';
import {
  chargesAttempt,
  cooldownLeft,
  envError,
  environmentalFailure,
  MAX_OFFLINE_MS,
} from '../_shared/angle-backoff.ts';

const STAFF = ['ops', 'admin', 'ads_manager'];
const BATCH_SIZE = 5;
const LEASE_MS = 3 * 60_000;
const MAX_ATTEMPTS = 3;
/* The audit machine refuses a brief label longer than this with a 422
   (Backend/app/schemas.py), and a refusal used to repeat every minute. */
const LABEL_MAX = 80;

const Body = z.object({ budgetMs: z.number().int().min(15_000).max(110_000).optional() });

interface Batch {
  id: string;
  brand: string;
  month: string;
  state: string;
  provider_job: string | null;
  n_videos: number;
  attempts: number;
}

/** Hold a batch for this tick. Returns null when somebody else has it. */
async function claimBatch(db: SupabaseClient): Promise<Batch | null> {
  const nowIso = new Date().toISOString();
  const { data: candidates } = await db
    .from('collab_angle_batches')
    .select('id')
    .in('state', ['submitting', 'running', 'filing'])
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .order('created_at', { ascending: true })
    .limit(1);
  const id = (candidates ?? [])[0]?.id as string | undefined;
  if (!id) return null;

  const { data } = await db
    .from('collab_angle_batches')
    .update({ lease_until: new Date(Date.now() + LEASE_MS).toISOString() })
    .eq('id', id)
    .or(`lease_until.is.null,lease_until.lt.${nowIso}`)
    .select('id, brand, month, state, provider_job, n_videos, attempts')
    .maybeSingle();
  return (data as Batch | null) ?? null;
}

async function release(db: SupabaseClient, id: string, patch: Record<string, unknown> = {}) {
  await db.from('collab_angle_batches').update({ lease_until: null, ...patch }).eq('id', id);
}

/**
 * Put videos back in the queue, charging an attempt or not.
 *
 * A video that has used `MAX_ATTEMPTS` is `failed` and stays so until somebody
 * resets it. `charge: false` is for failures that were never the video's fault
 * (see `_shared/angle-backoff.ts`), so a dead quota cannot spend a queue's
 * retries.
 */
async function requeueVideos(
  db: SupabaseClient,
  rows: Array<{ id: string; attempts: number | null; reason?: string }>,
  reason: string,
  charge: (id: string) => boolean,
) {
  for (const row of rows) {
    const attempts = Number(row.attempts ?? 0) + (charge(row.id) ? 1 : 0);
    await db.from('collab_angle_videos').update({
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
      attempts,
      batch_id: null,
      last_error: (row.reason ?? reason).slice(0, 500),
    }).eq('id', row.id);
  }
}

/** The same, for everything still attached to a batch that cannot go on. */
async function requeueBatch(db: SupabaseClient, batchId: string, reason: string, charge: boolean) {
  const { data } = await db
    .from('collab_angle_videos')
    .select('id, attempts')
    .eq('batch_id', batchId);
  await requeueVideos(
    db,
    (data ?? []) as Array<{ id: string; attempts: number | null }>,
    reason,
    () => charge,
  );
}

/** How long a new batch must still wait after environmental failures. */
async function waitLeft(db: SupabaseClient): Promise<number> {
  const { data } = await db
    .from('collab_angle_batches')
    .select('finished_at, error')
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(10);
  return cooldownLeft((data ?? []) as Array<{ finished_at: string | null; error: string | null }>);
}

/** This brand's briefs, in the shape the audit machine wants them. */
async function briefsFor(db: SupabaseClient, brand: string): Promise<BriefRef[]> {
  const { data } = await db
    .from('collab_brand_briefs')
    .select('brand, aliases, product, brief_url, angles, position')
    .eq('is_active', true)
    .order('position', { ascending: true });
  const want = brand.trim().toLowerCase();
  return ((data ?? []) as Array<{
    brand: string;
    aliases: string[] | null;
    product: string;
    brief_url: string;
    angles: string[] | null;
  }>)
    .filter((b) =>
      (b.brand ?? '').trim().toLowerCase() === want ||
      (b.aliases ?? []).some((a) => (a ?? '').trim().toLowerCase() === want)
    )
    .map((b) => ({
      url: b.brief_url,
      /* The machine hands this back as the brief a video followed, and an
         empty label would be useless on the way back. */
      label: ((b.product ?? '').trim() || brand).slice(0, LABEL_MAX),
      angles: b.angles ?? [],
    }));
}

/** Make the next batch out of queued videos, if there are any. */
async function makeBatch(db: SupabaseClient): Promise<Batch | null> {
  const { data: next } = await db
    .from('collab_angle_videos')
    .select('brand, month')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);
  const head = (next ?? [])[0] as { brand: string; month: string } | undefined;
  if (!head) return null;

  const { data: rows } = await db
    .from('collab_angle_videos')
    .select('id, video_id, video_url')
    .eq('status', 'queued')
    .eq('brand', head.brand)
    .eq('month', head.month)
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE);
  const videos = (rows ?? []) as Array<{ id: string; video_id: string; video_url: string }>;
  if (!videos.length) return null;

  const { data: batch } = await db
    .from('collab_angle_batches')
    .insert({
      brand: head.brand,
      month: head.month,
      state: 'submitting',
      n_videos: videos.length,
      lease_until: new Date(Date.now() + LEASE_MS).toISOString(),
    })
    .select('id, brand, month, state, provider_job, n_videos, attempts')
    .single();
  if (!batch) return null;

  /* Still `queued` only: another tick may have taken some of these between
     the read above and here, and a video must belong to one batch. */
  const { data: taken } = await db
    .from('collab_angle_videos')
    .update({ status: 'sent', batch_id: (batch as Batch).id })
    .in('id', videos.map((v) => v.id))
    .eq('status', 'queued')
    .select('id');

  const n = (taken ?? []).length;
  if (!n) {
    await db.from('collab_angle_batches').delete().eq('id', (batch as Batch).id);
    return null;
  }
  if (n !== videos.length) {
    await db.from('collab_angle_batches').update({ n_videos: n }).eq('id', (batch as Batch).id);
  }
  return { ...(batch as Batch), n_videos: n };
}

/** Send a batch to the machine, adopting a job it may already have started. */
async function submit(db: SupabaseClient, batch: Batch): Promise<string> {
  const creds = auditCreds();

  /* The reply to a previous submit may have been lost. The batch id travels
     as the job's label precisely so it can be recognised here. */
  const already = await findJobByLabel(creds, batch.id);
  if (already) {
    await db.from('collab_angle_batches')
      .update({ provider_job: already, state: 'running', submitted_at: new Date().toISOString() })
      .eq('id', batch.id);
    return already;
  }

  const { data: rows } = await db
    .from('collab_angle_videos')
    .select('video_url')
    .eq('batch_id', batch.id);
  const urls = [
    ...new Set(((rows ?? []) as Array<{ video_url: string }>).map((r) => canonicalVideoUrl(r.video_url))),
  ];
  if (!urls.length) throw new Error('the batch has no videos');

  const briefs = await briefsFor(db, batch.brand);
  if (!briefs.length) throw new Error(`${batch.brand} has no active brief`);

  const { jobId } = await submitJob(creds, { videoUrls: urls, briefs, label: batch.id });
  await db.from('collab_angle_batches')
    .update({ provider_job: jobId, state: 'running', submitted_at: new Date().toISOString() })
    .eq('id', batch.id);
  return jobId;
}

/** A finished job: file what it decided, and mark every video of the batch. */
async function fileBatch(db: SupabaseClient, batch: Batch, job: Awaited<ReturnType<typeof jobState>>) {
  await db.from('collab_angle_batches').update({ state: 'filing' }).eq('id', batch.id);

  const { data: rows } = await db
    .from('collab_angle_videos')
    .select('id, video_id, video_url, attempts')
    .eq('batch_id', batch.id);
  const mine = (rows ?? []) as Array<
    { id: string; video_id: string; video_url: string; attempts: number | null }
  >;
  const byVideoId = new Map(mine.map((r) => [r.video_id, r]));

  /* Matched by video id, never by comparing the link text: the machine is
     given a canonical URL and hands that back, while our row holds whatever
     spelling the creator sheet has. */
  const toFile: Array<{ url: string; angle: string; row: typeof mine[number]; review: boolean; note: string | null; brief: string | null }> = [];
  for (const p of job.placements) {
    const row = byVideoId.get(tiktokVideoId(p.video ?? ''));
    if (!row) continue;
    toFile.push({
      url: row.video_url,
      angle: p.angle,
      row,
      review: Boolean(p.needs_review),
      note: p.note ?? null,
      brief: p.brief ?? null,
    });
  }

  /* A placement the machine itself is unsure of is not filed. "Matched None"
     from a video it could not really judge is indistinguishable, once filed,
     from one that genuinely fits nothing, and nobody would look at it again. */
  const confident = toFile.filter((t) => !t.review);
  let filed: string[] = [];
  let already: string[] = [];
  if (confident.length) {
    const res = await filePlacements(db, {
      brand: batch.brand,
      month: batch.month,
      placements: confident.map((t) => ({ url: t.url, angle: t.angle })),
    });
    filed = res.filed;
    already = res.alreadyFiled;
  }

  /* Anything the machine could not place at all. */
  const placedIds = new Set(toFile.map((t) => t.row.id));
  const unplacedById = new Map(
    job.unplaced.map((u) => [tiktokVideoId(u.video ?? ''), u.reason ?? 'not placed']),
  );
  const unplaced = mine
    .filter((row) => !placedIds.has(row.id))
    .map((row) => ({
      row,
      reason: String(
        unplacedById.get(row.video_id) ?? job.error ?? 'the audit did not return this video',
      ),
    }));

  /* WHY A VIDEO CAME BACK WITHOUT AN ANSWER DECIDES WHETHER IT IS CHARGED. When
     nothing in the batch was confidently placed and every reason is the
     environment (the Gemini quota, TikTok refusing the machine), the videos did
     nothing wrong. See `_shared/angle-backoff.ts`.

     The "could not tell" notes are included on purpose. A quota that dies
     during the vision or judging pass does not always produce `unplaced`
     videos: the audit machine files them as `needs_review` placements whose
     note is "no visual evidence" or "the angle judgement returned nothing", and
     without counting those the batch would look like a success. */
  const nVideos = mine.length;
  const environment = environmentalFailure(
    [...toFile.filter((t) => t.review).map((t) => t.note), ...unplaced.map((u) => u.reason)],
    { confidentCount: confident.length, nVideos },
  );

  const filedSet = new Set(filed);
  const alreadySet = new Set(already);
  /* Videos that must go round again: a review placement on its first go, and a
     placement that filing neither wrote nor recognised (both charged), and
     review placements that were really the environment (not charged). */
  const again: Array<{ id: string; attempts: number | null; reason: string }> = [];
  const free: Array<{ id: string; attempts: number | null; reason: string }> = [];
  let reviewed = 0;
  for (const t of toFile) {
    if (t.review) {
      if (environment) {
        free.push({ id: t.row.id, attempts: t.row.attempts, reason: t.note ?? 'could not tell' });
        continue;
      }
      /* The machine's own docs say to re-run a "could not tell" once before
         anybody is asked to look. The evidence is cached, so it is cheap. */
      if (Number(t.row.attempts ?? 0) < 1) {
        again.push({
          id: t.row.id,
          attempts: t.row.attempts,
          reason: `needs review, re-running once: ${t.note ?? 'no note'}`,
        });
        continue;
      }
      reviewed += 1;
    } else if (!alreadySet.has(t.url) && !filedSet.has(t.url)) {
      /* Filing wrote nothing for it. Leaving it `queued` with no charge looped
         for ever, so it is charged like any other failure. */
      again.push({ id: t.row.id, attempts: t.row.attempts, reason: 'filing did not place this video' });
      continue;
    }
    const status = t.review
      ? 'needs_review'
      : alreadySet.has(t.url)
      ? 'skipped'
      : 'filed';
    await db.from('collab_angle_videos').update({
      status,
      angle: t.angle,
      brief_label: t.brief,
      last_error: t.review ? t.note : null,
      filed_at: status === 'filed' ? new Date().toISOString() : null,
    }).eq('id', t.row.id);
  }
  /* The first review retry is charged: it is what moves a video on to the
     "already retried" branch above. An environmental one is not. */
  await requeueVideos(db, again, '', () => true);
  await requeueVideos(db, free, '', () => false);

  for (const u of unplaced) {
    await requeueVideos(db, [u.row], u.reason, () => chargesAttempt(u.reason, nVideos));
  }

  await db.from('collab_angle_batches').update({
    state: 'done',
    finished_at: new Date().toISOString(),
    lease_until: null,
    /* The marker is what makes the worker wait before the next batch. */
    error: environment ? envError(environment) : job.error,
  }).eq('id', batch.id);

  return {
    filed: filed.length,
    already: already.length,
    review: reviewed,
    retrying: again.length,
    environment: environment ?? null,
  };
}

Deno.serve(async (req) => {
  const started = Date.now();
  const reply = (body: unknown, status = 200) => json(body, status, req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  /* ── who is asking ───────────────────────────────────────────────────── */
  const secret = Deno.env.get('COLLAB_ANGLES_SYNC_SECRET') ?? '';
  const presented = req.headers.get('x-sync-secret') ?? '';
  let isCron = false;
  if (secret && presented) {
    const a = new TextEncoder().encode(presented);
    const b = new TextEncoder().encode(secret);
    if (a.length === b.length) {
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
      isCron = diff === 0;
    }
  }
  if (!isCron) {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return reply({ error: 'Not allowed' }, 401);
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return reply({ error: 'Not allowed' }, 401);
    const { data: profile } = await db
      .from('profiles').select('role, is_active').eq('id', who.user.id).single();
    if (!profile?.is_active || !STAFF.includes(String(profile.role))) {
      return reply({ error: 'Not allowed' }, 403);
    }
  }

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    /* an empty body is a scheduled run */
  }
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) return reply({ error: 'Bad request' }, 400);
  /* The scheduler's own call gives up at 120s, so a tick must finish well
     inside that. Each step below is one short HTTP call; the budget decides
     whether there is room to start the next batch as well as finish this one. */
  const deadline = started + (parsed.data.budgetMs ?? 100_000);

  let batch = await claimBatch(db);
  let made = false;
  if (!batch) {
    /* After batches that failed for the environment (the free Gemini quota
       being spent), wait rather than feed the queue into the same wall. A batch
       already in flight is never held up by this, only the making of a new one. */
    const wait = await waitLeft(db);
    if (wait > 0) return reply({ ok: true, idle: true, cooling_down_s: Math.ceil(wait / 1000) });
    batch = await makeBatch(db);
    made = Boolean(batch);
  }
  if (!batch) return reply({ ok: true, idle: true });

  try {
    if (batch.state === 'submitting' || !batch.provider_job) {
      const jobId = await submit(db, batch);
      await release(db, batch.id);
      return reply({ ok: true, batch: batch.id, brand: batch.brand, submitted: jobId, made });
    }

    const creds = auditCreds();
    let job;
    try {
      job = await jobState(creds, batch.provider_job);
    } catch (err) {
      if (isMissingJob(err)) {
        /* The machine restarted and lost the job. Put the videos back. */
        await db.from('collab_angle_videos')
          .update({ status: 'queued', batch_id: null })
          .eq('batch_id', batch.id);
        await release(db, batch.id, {
          state: 'failed',
          error: 'the audit machine no longer has this job; its videos were re-queued',
          finished_at: new Date().toISOString(),
        });
        return reply({ ok: true, batch: batch.id, requeued: true });
      }
      throw err;
    }

    if (!job.terminal) {
      await release(db, batch.id, {
        last_phase: job.phase,
        last_polled_at: new Date().toISOString(),
      });
      /* Best effort and separate: if the column is not there yet (migration
         20261029120000), this fails alone and the poll above is unaffected. */
      if (job.progress) {
        await db.from('collab_angle_batches')
          .update({ last_progress: job.progress }).eq('id', batch.id)
          .then(() => {}, () => {});
      }
      return reply({ ok: true, batch: batch.id, phase: job.phase, status: job.status });
    }

    const filed = await fileBatch(db, batch, job);

    /* A batch just ended and the machine is now idle. Starting the next one
       here rather than waiting for the next minute keeps it fed, but only
       while there is budget left to do it in. */
    let next: string | null = null;
    if (Date.now() < deadline - 30_000 && (await waitLeft(db)) === 0) {
      const follow = await makeBatch(db);
      if (follow) {
        try {
          next = await submit(db, follow);
          await release(db, follow.id);
        } catch (err) {
          /* Whatever stopped it, the batch stays `submitting` with its videos
             attached and the next tick picks it up. */
          await release(db, follow.id, {
            error: err instanceof Error ? err.message.slice(0, 500) : String(err),
          });
        }
      }
    }
    return reply({ ok: true, batch: batch.id, brand: batch.brand, ...filed, next });
  } catch (err) {
    /* The machine being away is not this batch's fault: leave it exactly as
       it was and try again on the next tick. */
    if (err instanceof AuditOffline) {
      /* Unreachable for a long time is no longer "try again later": it is
         something a person should see. The batch is closed with the
         environmental marker (so the worker backs off) and its videos go back
         uncharged. The age is the batch's own, since nothing else records when
         it first could not be reached. */
      const created = await db.from('collab_angle_batches').select('created_at')
        .eq('id', batch.id).maybeSingle();
      const age = Date.now() - Date.parse((created.data as { created_at?: string } | null)?.created_at ?? '');
      if (Number.isFinite(age) && age > MAX_OFFLINE_MS) {
        const why = `the audit machine has been unreachable for over ${MAX_OFFLINE_MS / 3_600_000} hours: ${err.message}`;
        await requeueBatch(db, batch.id, why, false);
        await release(db, batch.id, {
          state: 'failed',
          error: envError(why),
          finished_at: new Date().toISOString(),
        });
        return reply({ ok: false, offline: true, gave_up: true, batch: batch.id, detail: why });
      }
      await release(db, batch.id, { error: err.message });
      return reply({ ok: true, offline: true, batch: batch.id, detail: err.message });
    }

    const message = err instanceof Error ? err.message : String(err);
    console.error('collab-angles-sync failed', batch.id, message);

    if (err instanceof AuditRefused) {
      /* 429 is the audit queue being full, which is a wait and not a fault. */
      if (err.status === 429) {
        await release(db, batch.id, { error: message.slice(0, 500) });
        return reply({ ok: true, queue_full: true, batch: batch.id, detail: message });
      }
      /* 401 and 403 are our key or our permission, the same for every video:
         wait, and do not blame the videos. Anything else (a 422, say) is about
         what we sent. It used to put the videos back uncharged and build the
         same refused batch every minute for ever; now each refusal costs them
         an attempt, so three of them end it. */
      const config = err.status === 401 || err.status === 403;
      await requeueBatch(db, batch.id, message, !config);
      await release(db, batch.id, {
        attempts: batch.attempts + 1,
        state: 'failed',
        error: config ? envError(message) : message.slice(0, 500),
        finished_at: new Date().toISOString(),
      });
      return reply({ ok: false, batch: batch.id, refused: err.status, error: message }, 200);
    }

    const attempts = batch.attempts + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    if (dead) {
      /* A batch that has failed three times for our own reasons (no brief, a
         bad row) is charged to its videos too; before, they went straight back
         into the queue and the same failure repeated. */
      await requeueBatch(db, batch.id, message, true);
    }
    await release(db, batch.id, {
      attempts,
      error: message.slice(0, 500),
      ...(dead ? { state: 'failed', finished_at: new Date().toISOString() } : {}),
    });
    return reply({ ok: false, batch: batch.id, error: message }, 200);
  }
});
