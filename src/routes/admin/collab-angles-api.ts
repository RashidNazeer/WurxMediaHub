import { getSupabase } from '@/lib/supabase';

/**
 * How the Categorise button AND the queue panel talk to `collab-angles`.
 *
 * One place, so both get the same timeout, the same retry of a transient 502,
 * 503 or 504, and the same readable error. It lives in its own file because the
 * button imports the panel and the panel needs this, and two files importing
 * each other would be a cycle.
 */

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

export async function callAngles<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
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
