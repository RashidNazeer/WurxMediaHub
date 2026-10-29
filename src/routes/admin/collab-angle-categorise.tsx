import { useCallback, useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

/**
 * The "Categorise" button in the Creative angle testing header.
 *
 * THIS FILE IS THE SEAM, AND IT IS OURS. Like `collab-ad-figures.tsx`, it is the
 * only place that touches our backend on behalf of the vendored WurxBase
 * screen. `CreativeAngles.jsx` imports THIS component (through a fenced block
 * that `scripts/wurxbase-patches.mjs` applies) and never a Supabase client, so
 * `pnpm verify:isolation` still holds.
 *
 * WHAT IT DOES. One click asks the `collab-angles` Edge Function to queue every
 * video this brand posted in this month. A cron worker judges them in batches
 * of five against the brand's briefs and files them under the right angle. The
 * browser never sees a video list, a brief or an angle name: the function
 * derives all of it server side, and this button only says "do this brand and
 * month" and then watches a count.
 *
 * THE RING IS THE PROGRESS BAR. Done over total, where done means every state a
 * video can end in (filed, skipped, failed, needs review), so a run that fails
 * half its videos still reaches a full ring instead of hanging at 50.
 */

type LiveBatch = {
  step: number;
  steps: number;
  label: string;
  videos_judged: number;
  videos_total: number;
  /** Seconds the audit machine had been silent when the worker last asked. */
  quiet_s: number | null;
};

type Progress = {
  total: number;
  queued: number;
  sent: number;
  filed: number;
  skipped: number;
  failed: number;
  needs_review: number;
  /** Videos failing for a reason that looks like the Gemini model (outage or quota). 0 when an older function omits it. */
  model_failures: number;
  /** Every video the brand posted this month. 0 when an older function omits it. */
  total_videos: number;
  /** How many of those already sit in an angle. 0 when an older function omits it. */
  already_categorised: number;
  running_batch: {
    state: string;
    last_phase: string | null;
    n_videos: number;
    /** What the audit machine says it is doing. Null from an older function or backend. */
    live: LiveBatch | null;
    batch_no: number;
    batches: number;
    /** Seconds since the worker last heard from the audit machine. */
    heard_s: number | null;
  } | null;
  eta_seconds: number | null;
};

/** Every field optional: an older deployed function may send only some. */
type StartResult = {
  total_videos?: number;
  queued?: number;
  already_categorised?: number;
  already_queued?: number;
  skipped_no_date?: number;
};

/** How often to ask while work is in flight. */
const POLL_MS = 5000;

const PHASE_WORDS: Record<string, string> = {
  brief: 'Reading the brief',
  ingest: 'Downloading videos',
  phase1: 'Decoding',
  phase2: 'Transcribing',
  phase3: 'Watching',
  phase5: 'Judging',
  phase6: 'Judging',
  phase7: 'Judging',
  done: 'Done',
};

/**
 * `functions.invoke` hides the real error body behind `error.context`, which is
 * the raw Response. Same approach as `messageFrom` in `src/lib/tiktok.ts`.
 */
/** The HTTP status behind a `functions.invoke` error, when there was a response. */
function statusOf(error: unknown): number | undefined {
  const status = (error as { context?: Response })?.context?.status;
  return typeof status === 'number' ? status : undefined;
}

async function messageFrom(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  const status = statusOf(error);
  let detail = '';
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
      /* The gateway and the edge runtime answer in their own shape, with
         `message` and no `error`: {"code":401,"message":"Invalid JWT"}, or a
         boot error. Without reading it the screen can only say "refused",
         which is how one transient 503 became a mystery. */
      if (typeof body?.message === 'string') detail = body.message;
    } catch {
      /* not JSON: fall through to the translations below */
    }
  }
  const raw = (error as Error)?.message || fallback;

  /* SUPABASE'S OWN WORDING IS NOT AN ANSWER. "Failed to send a request to the
     Edge Function" is what a browser reports when the request never completed
     at all, and the commonest reason by far is that the function is not
     deployed on this project: there is nothing there to answer the browser's
     preflight, so it never even gets as far as a status code. Saying that is
     the difference between a person knowing what to do and filing a bug. */
  if (/failed to send a request/i.test(raw)) {
    return 'The categorising service did not answer. It may not be deployed on ' +
      'this project yet, or something between here and Supabase is blocking ' +
      'the request.';
  }
  if (/non-2xx/i.test(raw)) {
    if (status === 401) {
      return 'Your sign-in was not accepted. Sign out and back in, then try again.';
    }
    return `The categorising service returned an error${status ? ` (${status})` : ''}` +
      `${detail ? `: ${detail}` : ''}. ` +
      (status !== undefined && status >= 500
        ? 'This is usually temporary, so try again in a moment. '
        : 'Try again. ') +
      'If it keeps happening, the collab-angles function log will say why.';
  }
  return raw;
}

/**
 * A CALL THAT CANNOT HANG. `functions.invoke` has no timeout of its own, so a
 * request that never completes, which is what a dead tunnel or a sleeping
 * laptop looks like from here, would leave the button disabled with a ring at
 * nought and no way back except reloading the page.
 */
const CALL_TIMEOUT_MS = 20_000;

/* A 502, 503 or 504 comes from the platform in front of the function, and
   retrying is safe: collab-angles is idempotent. `angles.progress` only reads,
   and `angles.start` skips every video that is already filed or queued. One
   transient 503 once reached the screen as "refused the request" when the very
   next call would have worked. A 500 is NOT retried: that is the function's own
   handler failing, and it may already have written part of its work. */
const TRANSIENT_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [1_000, 3_000];

async function callAngles<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const abort = new AbortController();
    const timer = window.setTimeout(() => abort.abort(), CALL_TIMEOUT_MS);
    let data: unknown;
    let error: unknown;
    try {
      ({ data, error } = await getSupabase().functions.invoke('collab-angles', {
        body,
        signal: abort.signal,
      }));
    } catch (e) {
      throw new Error(
        abort.signal.aborted
          ? 'The server did not answer in 20 seconds. Try again in a moment.'
          : await messageFrom(e, fallback),
      );
    } finally {
      window.clearTimeout(timer);
    }
    if (error) {
      const status = statusOf(error);
      if (status !== undefined && TRANSIENT_STATUSES.has(status) && attempt < RETRY_DELAYS_MS.length) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        continue;
      }
      throw new Error(await messageFrom(error, fallback));
    }
    if ((data as { error?: string } | null)?.error) throw new Error((data as { error: string }).error);
    return data as T;
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Narrow the function's reply to what the button needs, tolerating gaps. */
function toProgress(raw: unknown): Progress {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rb = r.running_batch as Record<string, unknown> | null | undefined;
  const lv = rb?.progress as Record<string, unknown> | null | undefined;
  const polled = typeof rb?.polled_at === 'string' ? Date.parse(rb.polled_at) : NaN;
  const eta = r.eta_seconds;
  return {
    total: num(r.total),
    queued: num(r.queued),
    sent: num(r.sent),
    filed: num(r.filed),
    skipped: num(r.skipped),
    failed: num(r.failed),
    needs_review: num(r.needs_review),
    model_failures: num(r.model_failures),
    total_videos: num(r.total_videos),
    already_categorised: num(r.already_categorised),
    running_batch: rb
      ? {
          state: String(rb.state ?? ''),
          last_phase: typeof rb.last_phase === 'string' ? rb.last_phase : null,
          n_videos: num(rb.n_videos),
          live: lv && typeof lv === 'object' && num(lv.steps) > 0
            ? {
                step: num(lv.step),
                steps: num(lv.steps),
                label: typeof lv.label === 'string' ? lv.label : '',
                videos_judged: num(lv.videos_judged),
                videos_total: num(lv.videos_total),
                quiet_s: typeof lv.seconds_since_activity === 'number' ? lv.seconds_since_activity : null,
              }
            : null,
          batch_no: num(rb.batch_no),
          batches: num(rb.batches),
          heard_s: Number.isFinite(polled) ? Math.max(0, (Date.now() - polled) / 1000) : null,
        }
      : null,
    eta_seconds: typeof eta === 'number' && Number.isFinite(eta) && eta > 0 ? eta : null,
  };
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-08" becomes "August 2026"; anything unexpected is shown as given. */
function monthLabel(month: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  const name = m ? MONTH_NAMES[Number(m[2]) - 1] : undefined;
  return m && name ? `${name} ${m[1]}` : month;
}

const videos = (n: number) => `${n} video${n === 1 ? '' : 's'}`;

/**
 * What to say when a press queued nothing, or null when it queued something and
 * the progress line speaks for itself. First match wins, in the order agreed
 * with the Edge Function. A missing field reads as 0, so an older deployed
 * function never crashes this, it just gets the plainer fallback.
 */
function startNote(res: StartResult | null | undefined, brand: string, month: string): string | null {
  const queued = num(res?.queued);
  if (queued > 0) return null;
  const totalVideos = num(res?.total_videos);
  const categorised = num(res?.already_categorised);
  const alreadyQueued = num(res?.already_queued);
  const noDate = num(res?.skipped_no_date);
  if (totalVideos === 0 && typeof res?.total_videos === 'number') {
    return `No videos posted for ${brand} in ${monthLabel(month)}.`;
  }
  if (totalVideos > 0 && categorised === totalVideos) {
    /* "All 1 video are" is the kind of sentence that makes a careful product
       look careless, and a brand with one video that month is not rare. */
    return totalVideos === 1
      ? 'That video is already categorised.'
      : `All ${videos(totalVideos)} are already categorised.`;
  }
  if (alreadyQueued > 0) return `Already categorising ${videos(alreadyQueued)}.`;
  if (noDate > 0) {
    return `${videos(noDate)} ${noDate === 1 ? 'has' : 'have'} no date, so ${noDate === 1 ? 'it cannot' : 'they cannot'} be filed by month.`;
  }
  return 'Nothing new to categorise.';
}

const doneOf = (p: Progress) => p.filed + p.skipped + p.failed + p.needs_review;
const activeOf = (p: Progress | null) => !!p && p.queued + p.sent > 0;
/* Work that is happening now: a batch out with the audit service, or videos
   sent to it. Videos that are merely queued are NOT this. After an error the
   worker leaves them queued to retry later, sometimes for an hour, and treating
   them as running kept the button disabled for as long as the service stayed
   down, so nobody could press it again. Pressing it while they wait is safe:
   the Edge Function reports them as already queued instead of adding them again. */
const runningOf = (p: Progress | null) =>
  !!p && (p.sent > 0 || ['submitting', 'running', 'filing'].includes(p.running_batch?.state ?? ''));

type Props = {
  brand: string;
  month: string;
  canEdit: boolean;
  /** Called when more videos have been filed since the last look. */
  onFiled?: () => void;
};

export function CollabAngleCategorise({ brand, month, canEdit, onFiled }: Props) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /* True once a run was started or seen in flight, so a finished run keeps its
     "12 of 12 done" line but a brand nobody has touched stays quiet. */
  const [touched, setTouched] = useState(false);

  /* ALIVE IS SET ON THE WAY IN AS WELL AS CLEARED ON THE WAY OUT, and leaving
     that out is not a style point. StrictMode mounts, unmounts and remounts
     every component in development on purpose. A cleanup that only clears the
     flag leaves it false for the rest of the component's life, after which
     every setState below is skipped: the button dimmed, the ring appeared,
     and then nothing ever happened again. Found by pressing it. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /* Refs, so the poll never re-subscribes just because the parent re-rendered. */
  const onFiledRef = useRef(onFiled);
  useEffect(() => {
    onFiledRef.current = onFiled;
  }, [onFiled]);
  const lastFiled = useRef<number | null>(null);
  /* Guards a late answer for the previous brand or month from landing on this one. */
  const scope = useRef('');
  scope.current = `${brand}|${month}`;

  const ready = !!brand && !!month && canEdit;

  const look = useCallback(async (): Promise<Progress | null> => {
    const asked = `${brand}|${month}`;
    const raw = await callAngles<unknown>(
      { action: 'angles.progress', brand, month },
      'Could not read the progress.'
    );
    if (!alive.current || scope.current !== asked) return null;
    const next = toProgress(raw);
    const before = lastFiled.current;
    lastFiled.current = next.filed;
    setProgress(next);
    if (before !== null && next.filed > before) onFiledRef.current?.();
    return next;
  }, [brand, month]);

  /* A different brand or month is a different run: forget the old one. */
  useEffect(() => {
    lastFiled.current = null;
    setProgress(null);
    setError(null);
    setNote(null);
    setTouched(false);
  }, [brand, month]);

  /* One look on arrival, so a run begun earlier (or by a colleague) shows its ring. */
  useEffect(() => {
    if (!ready) return;
    look()
      .then((p) => {
        if (p && activeOf(p) && alive.current) setTouched(true);
      })
      .catch(() => {
        /* quiet: the button still works, and a click will surface a real error */
      });
  }, [ready, look]);

  const active = activeOf(progress);
  const running = runningOf(progress);

  useEffect(() => {
    if (!ready || !active) return;
    const id = window.setInterval(() => {
      look().catch((e: unknown) => {
        if (alive.current) setError((e as Error).message);
      });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [ready, active, look]);

  const start = async () => {
    if (starting || running) return;
    setStarting(true);
    setError(null);
    setNote(null);
    try {
      const res = await callAngles<StartResult>(
        { action: 'angles.start', brand, month },
        'Could not start categorising.'
      );
      if (!alive.current) return;
      setTouched(true);
      setNote(startNote(res, brand, month));
      await look();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setStarting(false);
    }
  };

  if (!brand || !month || !canEdit) return null;

  const busy = starting || running;
  const total = progress?.total ?? 0;
  const done = progress ? doneOf(progress) : 0;
  const pct = total > 0 ? Math.min(100, Math.max(0, (done / total) * 100)) : 0;

  let line = '';
  if (progress && total > 0 && (active || touched)) {
    /* When some of the month was already filed, say so in the same breath, so
       "5 videos" is not mistaken for the whole month. */
    const skippedAlready = progress.already_categorised;
    line = skippedAlready > 0
      ? `${done} of ${total} new video${total === 1 ? '' : 's'} done, ${skippedAlready} already categorised`
      : `${done} of ${total} video${total === 1 ? '' : 's'} done`;
    const phase = progress.running_batch?.last_phase
      ? PHASE_WORDS[progress.running_batch.last_phase]
      : undefined;
    if (active && phase) line += `. ${phase}`;
    if (active && progress.eta_seconds !== null) {
      const mins = Math.max(1, Math.round(progress.eta_seconds / 60));
      line += `. About ${mins} min left (estimate)`;
    }
  }
  /* THE MODEL BEING DOWN IS NOT A PROBLEM WITH THESE VIDEOS, and without this
     line the only sign is a number of failed videos with no reason. The audit
     machine's `module_failed` is nearly always the free Gemini quota (about 500
     requests a day, resetting daily), but it is also what a broken dependency
     says, hence "most likely". */
  const modelNote = progress && progress.model_failures > 0
    ? `${progress.model_failures} video${progress.model_failures === 1 ? '' : 's'} could not be analysed. ` +
      'Most likely the Gemini API is not working or its daily quota is used up ' +
      '(the free key allows about 500 requests a day and resets daily). ' +
      'They are tried again automatically, with longer waits while it stays down.'
    : null;
  /* WHAT THE AUDIT MACHINE IS DOING RIGHT NOW. A video takes minutes, and a
     bare "0 of 39 done" for the first half hour looks the same as a hung job.
     So say which batch, which step and, while judging, how many of this batch's
     videos are finished, and how long since the machine last moved on. */
  let live = '';
  const rbatch = progress?.running_batch;
  if (running && rbatch) {
    const lv = rbatch.live;
    const where = rbatch.batches > 1 ? `Batch ${rbatch.batch_no} of ${rbatch.batches}: ` : '';
    if (lv) {
      live = `${where}step ${lv.step} of ${lv.steps}, ${lv.label.toLowerCase()}`;
      if (lv.step === lv.steps && lv.videos_total > 0) {
        live += ` (${lv.videos_judged} of ${lv.videos_total} videos judged)`;
      } else if (lv.videos_total > 0) {
        live += ` (${lv.videos_total} videos in this batch)`;
      }
      /* Silence as the machine reported it, plus the time since we last asked. */
      const quiet = (lv.quiet_s ?? 0) + (rbatch.heard_s ?? 0);
      if (quiet >= 600) {
        live += `. No activity for ${Math.round(quiet / 60)} minutes. If this does not change, tell an admin`;
      } else if (quiet >= 90) {
        live += `. Last activity ${Math.round(quiet / 60)} min ago, still working on this step`;
      } else {
        live += '. Working';
      }
    } else {
      const ph = rbatch.last_phase ? PHASE_WORDS[rbatch.last_phase] : undefined;
      live = `${where}${rbatch.n_videos} videos with the audit service${ph ? `: ${ph.toLowerCase()}` : ''}`;
    }
  }
  const problem = error !== null || (note === null && modelNote !== null);
  /* The start message ("Already categorising 5 videos") is about what the
     person just did, so it comes before the standing note about the model. */
  const shown = error ?? note ?? modelNote ?? line;

  return (
    <div className="wx-cat" data-busy={busy ? 'true' : 'false'}>
      <div className="wx-cat-wrap">
        <button
          type="button"
          className="wx-cat-btn"
          onClick={start}
          disabled={busy}
          title={line || 'Sort the videos for this month into angles'}
          aria-busy={busy}
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
            <path d="M19 16v4M17 18h4" />
          </svg>
          Categorise
        </button>
        {busy && (
          <svg className="wx-cat-ring" aria-hidden="true" focusable="false">
            {/* The corner radius is set in CSS (rx/ry), because it must equal half the
                ring's height, and an SVG rx given as a big number would clamp to an
                ellipse instead of a pill. */}
            <rect className="wx-cat-track" x="0" y="0" width="100%" height="100%" fill="none" />
            <rect
              className="wx-cat-arc"
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="none"
              pathLength={100}
              strokeDasharray={100}
              strokeDashoffset={100 - pct}
            />
          </svg>
        )}
      </div>
      {live && !error && (
        <p className="wx-cat-status" role="status" data-live="true">
          {live}
        </p>
      )}
      {shown && (
        <p
          className={'wx-cat-status' + (problem ? ' wx-cat-status-err' : '')}
          role={problem ? 'alert' : 'status'}
        >
          {shown}
        </p>
      )}
    </div>
  );
}

export default CollabAngleCategorise;
