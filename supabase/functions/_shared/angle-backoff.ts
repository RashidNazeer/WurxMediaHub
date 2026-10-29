/**
 * When the categoriser should stop and wait instead of burning videos.
 *
 * No imports and no I/O, on purpose: the worker cannot be run without Deno and
 * a database, and these rules are the ones that decide whether a free Gemini
 * quota costs a queue its retries. `scripts/check-angles-backoff.mjs` runs
 * them directly.
 *
 * THE PROBLEM. The audit machine reports a video it could not judge as
 * "unplaced" with a reason. The worker used to treat every reason alike: add
 * one to the video's attempts, queue it again at once, start the next batch.
 * That is right for a video that is itself bad. It is wrong when the cause is
 * the ENVIRONMENT, and on the free Gemini key (about 500 requests a day) the
 * environment fails every video the same way until the quota resets. Three
 * such batches and every video in the queue was `failed` for something that
 * was never its fault.
 *
 * THE RULE, in two parts:
 *
 *   1. In a batch of MORE THAN ONE video, a failure whose reason is the
 *      environment is not charged to the video. A bad video among good ones is
 *      still caught: it ends up alone in a later batch, where it IS charged. A
 *      lone video that fails with a model reason must be able to run out of
 *      attempts, or it sits at the head of the queue and blocks everything
 *      behind it for ever.
 *   2. A batch where NOTHING was confidently placed and every reason is
 *      environmental is marked with `ENV:` in its `error`. The worker then
 *      waits before making another batch, longer each time it happens in a
 *      row, and a batch that works clears it.
 *
 * THE STRINGS BELOW ARE THE AUDIT MACHINE'S OWN, read from its source
 * (audit-backend/Backend, 2026-10-30), not guessed:
 *   - `module_failed`: app/services/pipeline.py sets it when a model call
 *     failed, and `angle_groups` reports it as the bare reason
 *     (`r.get('error') or r.get('status')`) in `unplaced`. The job still
 *     reports `succeeded`, so nothing else says the quota is gone.
 *   - the two `needs_review` notes from `_unsure`: "no visual evidence: ..."
 *     and "the angle judgement returned nothing for this video". A quota that
 *     dies part way through arrives as these, as PLACEMENTS and not as unplaced
 *     videos, so the worker has to read them too.
 *   - "not judged against every brief": its own docs say a rate limit, or the
 *     job running out of time.
 *   - "could not download this link", and the job error "no video could be
 *     downloaded. TikTok often refuses anonymous requests from a datacentre
 *     IP -- set AUDITOR_COOKIES_FILE ...".
 * A brief that fails to compile is deliberately NOT here: that is about the
 * brand, not the environment.
 */

/** Prefix on `collab_angle_batches.error` that means "the environment, not the videos". */
export const ENV_MARK = 'ENV:';

export const BASE_COOLDOWN_MS = 5 * 60_000;
/* The free quota resets once a day, so there is nothing to gain from asking
   more often than hourly once it is clearly gone, and one probe an hour costs
   one failed batch an hour. */
export const MAX_COOLDOWN_MS = 60 * 60_000;

const MODEL_DOWN =
  /module_failed|resource[_ ]exhausted|quota|rate[ -]?limit|\b429\b|gemini|model call|no visual evidence|angle judgement returned nothing|not judged against every brief/i;
const SOURCE_DOWN =
  /could not download|unable to download|could be downloaded|download(?:ing)? (?:failed|error)|sign in to confirm|not a bot|cookies?|refuses anonymous|http error (?:403|429)/i;

export type Cause = 'model' | 'source' | 'video';

/** What a reason string from the audit machine is really about. */
export function causeOf(reason: string | null | undefined): Cause {
  const r = reason ?? '';
  if (MODEL_DOWN.test(r)) return 'model';
  if (SOURCE_DOWN.test(r)) return 'source';
  return 'video';
}

/**
 * Whether a reason is the environment's fault. Only ever true for a batch of
 * more than one video: a lone video that fails cannot be told apart from a bad
 * video, and must be able to run out of attempts.
 */
export function isEnvironmental(reason: string | null | undefined, nVideos: number): boolean {
  return nVideos > 1 && causeOf(reason) !== 'video';
}

/** Whether an unplaced video should be charged an attempt. */
export function chargesAttempt(reason: string | null | undefined, nVideos: number): boolean {
  return !isEnvironmental(reason, nVideos);
}

/**
 * The reason to record on a batch when it failed wholesale for an
 * environmental cause, else null. `confidentCount` is the number of videos
 * given a real answer; any at all means the machine and the model were working.
 */
export function environmentalFailure(
  reasons: Array<string | null | undefined>,
  batch: { confidentCount: number; nVideos: number },
): string | null {
  if (batch.confidentCount > 0 || reasons.length === 0) return null;
  return reasons.every((r) => isEnvironmental(r, batch.nVideos))
    ? String(reasons[0] ?? 'environment')
    : null;
}

/** `ENV: <reason>`, within the column's practical length. */
export const envError = (reason: string): string => `${ENV_MARK} ${reason}`.slice(0, 500);

export const isEnvError = (error: string | null | undefined): boolean =>
  typeof error === 'string' && error.startsWith(ENV_MARK);

/** 5, 10, 20, 40, 60, 60 ... minutes for 1, 2, 3, 4, 5, 6 ... failures in a row. */
export function cooldownMs(consecutive: number): number {
  if (consecutive <= 0) return 0;
  return Math.min(MAX_COOLDOWN_MS, BASE_COOLDOWN_MS * 2 ** (consecutive - 1));
}

/**
 * Milliseconds still to wait before a new batch may be made.
 *
 * `finished` is the most recently finished batches, newest first. The count is
 * of environmental failures at the head of that list: the first batch that did
 * anything else ends the run, which is how a recovered quota clears the wait
 * with no explicit reset.
 */
export function cooldownLeft(
  finished: Array<{ finished_at: string | null; error: string | null }>,
  now = Date.now(),
): number {
  let run = 0;
  for (const b of finished) {
    if (!isEnvError(b.error)) break;
    run += 1;
  }
  if (run === 0) return 0;
  const last = Date.parse(finished[0]?.finished_at ?? '');
  if (!Number.isFinite(last)) return 0;
  return Math.max(0, last + cooldownMs(run) - now);
}

/** How long a batch may sit unreachable before somebody should be told. */
export const MAX_OFFLINE_MS = 6 * 60 * 60_000;

/** FastAPI's `detail` is a string, or a list of `{loc, msg}` for a 422. */
export function describeDetail(detail: unknown): string | null {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail.map((d) => {
      if (typeof d === 'string') return d;
      const o = d as { loc?: unknown; msg?: unknown } | null;
      const where = Array.isArray(o?.loc)
        ? o.loc.filter((p) => p !== 'body').join('.')
        : '';
      const msg = typeof o?.msg === 'string' ? o.msg : '';
      return [where, msg].filter(Boolean).join(': ');
    }).filter(Boolean);
    return parts.length ? parts.join('; ').slice(0, 300) : null;
  }
  return null;
}
