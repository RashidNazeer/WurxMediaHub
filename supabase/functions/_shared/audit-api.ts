/**
 * The video audit backend, as this project talks to it.
 *
 * It is not a hosted service. It runs on one machine behind a tunnel, answers
 * one job at a time, and takes about five minutes a video, so everything here
 * is written for a thing that is often slow and sometimes simply not there.
 *
 * THREE FAILURES THIS MODULE EXISTS TO TELL APART, because they want opposite
 * responses and all three arrive as "the request did not work":
 *
 *   OFFLINE   the tunnel is down, the machine is asleep, or the laptop lid is
 *             shut. The tunnel answers for it with an HTML error page. Nothing
 *             is wrong with our work: wait and ask again, spend no attempt.
 *   REFUSED   the backend answered, in JSON, that it will not do this. A bad
 *             brief link, too many videos, no API key. Retrying is pointless.
 *   BROKEN    it answered with something we cannot parse. Treated as offline,
 *             because the alternative is to burn a video's retry budget on a
 *             bad gateway.
 *
 * `/analyze` IS NOT IDEMPOTENT. Posting twice starts two jobs, and the machine
 * runs them one after another, so a lost response would block the queue for
 * half an hour and file the same videos twice. Every submission therefore
 * carries the batch id as its `label`, and `findJobByLabel` looks for that
 * label before posting again. A label is the only thing that survives a reply
 * we never saw.
 */

import { describeDetail } from './angle-backoff.ts';

/** Everything the caller needs to reach the backend. */
export interface AuditCreds {
  url: string;
  key: string;
}

export function auditCreds(): AuditCreds {
  const url = (Deno.env.get('AUDIT_API_URL') ?? '').trim().replace(/\/+$/, '');
  const key = (Deno.env.get('AUDIT_API_KEY') ?? '').trim();
  if (!url || !key) {
    throw new Error(
      'AUDIT_API_URL and AUDIT_API_KEY must be set as function secrets: ' +
        'supabase secrets set AUDIT_API_URL=... AUDIT_API_KEY=... --project-ref <ref>',
    );
  }
  return { url, key };
}

/** The backend could not be reached, or did not answer like itself. */
export class AuditOffline extends Error {
  readonly offline = true;
  constructor(message: string) {
    super(message);
    this.name = 'AuditOffline';
  }
}

/** The backend answered, and the answer is no. Retrying will not help. */
export class AuditRefused extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'AuditRefused';
    this.status = status;
  }
}

/* One request is a small JSON call. Twenty seconds is already generous; the
   long waiting is done by polling, never by holding a request open. */
const TIMEOUT_MS = 20_000;

async function call(
  creds: AuditCreds,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(creds.url + path, {
      method: init?.method ?? 'GET',
      headers: {
        'x-api-key': creds.key,
        /* Without this the tunnel serves its own HTML warning page to anything
           that looks like a browser, and the JSON parse below fails. */
        'ngrok-skip-browser-warning': '1',
        ...(init?.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
  } catch (err) {
    const why = err instanceof Error && err.name === 'AbortError'
      ? `no answer in ${TIMEOUT_MS / 1000}s`
      : String(err);
    throw new AuditOffline(`could not reach the audit machine (${why})`);
  } finally {
    clearTimeout(timer);
  }

  /* THE TUNNEL ANSWERING INSTEAD OF THE BACKEND. ngrok sets its own error
     code header and serves HTML. Both are read, because a future tunnel may
     only do one of them, and mistaking this for a real 404 is what would make
     the worker resubmit a job that is still running. */
  const kind = res.headers.get('content-type') ?? '';
  if (res.headers.get('ngrok-error-code') || !kind.includes('json')) {
    throw new AuditOffline(
      `the audit machine is not answering (HTTP ${res.status}, ${kind || 'no content type'}). ` +
        'It is a PC behind a tunnel: it may be asleep, or the tunnel may be down.',
    );
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new AuditOffline(`the audit machine sent something that is not JSON (HTTP ${res.status})`);
  }

  if (!res.ok) {
    const detail = (body as { detail?: unknown; error?: unknown } | null);
    /* FastAPI sends `detail` as a LIST of {loc, msg} for a 422, so testing for a
       string alone recorded only "HTTP 422" and hid which field was refused. */
    const msg = describeDetail(detail?.detail) ??
      (typeof detail?.error === 'string' ? detail.error : `HTTP ${res.status}`);
    /* 5xx is the backend falling over rather than refusing, so it is worth
       asking again later; 4xx is a decision and will not change. */
    if (res.status >= 500) throw new AuditOffline(`the audit machine errored: ${msg}`);
    throw new AuditRefused(msg, res.status);
  }
  return body;
}

/** `true` when the backend is up and ready to take work. */
export async function auditReady(creds: AuditCreds): Promise<boolean> {
  try {
    const r = await call(creds, '/ready') as { ready?: boolean };
    return r?.ready === true;
  } catch {
    return false;
  }
}

export interface BriefRef {
  url: string;
  label: string;
  angles: string[];
}

export interface SubmitResult {
  jobId: string;
}

/**
 * Start one job: up to five videos of one brand against that brand's briefs.
 *
 * `label` is the batch id and is the only way to recognise this job later if
 * the answer to this very call is lost.
 */
export async function submitJob(
  creds: AuditCreds,
  args: { videoUrls: string[]; briefs: BriefRef[]; label: string },
): Promise<SubmitResult> {
  const body = await call(creds, '/analyze', {
    method: 'POST',
    body: {
      video_urls: args.videoUrls,
      briefs: args.briefs.map((b) => ({
        url: b.url,
        label: b.label,
        ...(b.angles.length ? { angles: b.angles } : {}),
      })),
      label: args.label,
    },
  }) as { job_id?: string };
  if (!body?.job_id) throw new AuditOffline('the audit machine accepted the job but named no job id');
  return { jobId: body.job_id };
}

/** The job this batch already started, if it did. See the header. */
export async function findJobByLabel(
  creds: AuditCreds,
  label: string,
): Promise<string | null> {
  const rows = await call(creds, '/jobs?limit=50') as Array<
    { job_id?: string; label?: string | null }
  >;
  if (!Array.isArray(rows)) return null;
  const hit = rows.find((r) => (r?.label ?? '') === label);
  return hit?.job_id ?? null;
}

export interface Placement {
  video: string;
  angle: string;
  brief: string | null;
  needs_review: boolean;
  note: string | null;
}

export interface JobState {
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  phase: string;
  terminal: boolean;
  placements: Placement[];
  unplaced: Array<{ video: string | null; reason: string | null }>;
  warnings: string[];
  error: string | null;
  requested: number;
  downloaded: number;
  completed: number;
  elapsedS: number | null;
  /** The backend's own account of how far it has got; null from an older backend. */
  progress: Record<string, unknown> | null;
}

const TERMINAL = new Set(['succeeded', 'partial', 'failed']);

/**
 * Where a job has got to.
 *
 * NOTHING BUT `status` AND `phase` MEANS ANYTHING UNTIL IT IS TERMINAL. While
 * a job runs, `angles` already lists the brief's angle names with empty lists
 * and `placements` is empty, which reads exactly like "nothing matched". So
 * the caller is handed `terminal` and must check it before believing a result.
 */
export async function jobState(creds: AuditCreds, jobId: string): Promise<JobState> {
  const j = await call(creds, `/jobs/${encodeURIComponent(jobId)}`) as Record<string, unknown>;
  const status = String(j.status ?? 'queued') as JobState['status'];
  const placements = Array.isArray(j.placements) ? j.placements as Placement[] : [];
  return {
    status,
    phase: String(j.phase ?? ''),
    terminal: TERMINAL.has(status),
    placements,
    unplaced: Array.isArray(j.unplaced)
      ? j.unplaced as JobState['unplaced']
      : [],
    warnings: Array.isArray(j.warnings) ? j.warnings.map(String) : [],
    error: typeof j.error === 'string' ? j.error : null,
    requested: Number(j.requested_videos ?? 0),
    downloaded: Number(j.downloaded_videos ?? 0),
    completed: Number(j.completed_videos ?? 0),
    elapsedS: typeof j.elapsed_s === 'number' ? j.elapsed_s : null,
    progress: j.progress && typeof j.progress === 'object' ? j.progress as Record<string, unknown> : null,
  };
}

/** True when the backend genuinely has no such job, rather than being away. */
export function isMissingJob(err: unknown): boolean {
  return err instanceof AuditRefused && err.status === 404 && /no job/i.test(err.message);
}

/**
 * The TikTok video id inside a link, which is the only reliable identity a
 * video has here. `video_codes[].video` is free text written by three
 * different things, so the same video appears with tracking parameters, with
 * and without `www.`, and occasionally as a short link.
 */
export function tiktokVideoId(url: string): string {
  const m = /\/(?:video|photo|v)\/(\d{6,32})/.exec(url ?? '');
  if (m) return m[1]!;
  const n = /(\d{10,32})/.exec(url ?? '');
  return n ? n[1]! : '';
}

/**
 * The link we send the backend. Its own downloader is happiest with a
 * canonical URL, and sending the same video twice in two spellings makes it
 * report one of them as a duplicate rather than audit it.
 */
export function canonicalVideoUrl(url: string): string {
  const id = tiktokVideoId(url);
  if (!id) return url;
  const handle = /tiktok\.com\/(@[A-Za-z0-9._-]+)\//.exec(url ?? '');
  return handle
    ? `https://www.tiktok.com/${handle[1]}/video/${id}`
    : (url ?? '').split('?')[0]!.split('#')[0]!;
}
