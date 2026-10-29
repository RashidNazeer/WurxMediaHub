#!/usr/bin/env node
/**
 * Does the worker keep videos queued while Google is not answering, and carry on
 * when it is back?
 *
 * This runs the REAL `collab-angles-sync` handler, unchanged, in Node. Only its
 * edges are replaced: an in-memory database (scripts/lib/mock-supabase.mjs), a
 * fake audit backend that can be switched between healthy, Gemini down, Gemini
 * recovering, offline and 503, and a clock the script controls so a day of cron
 * ticks takes a moment. Each tick below is one run of the cron job.
 *
 * What it can NOT show: that the live audit machine produces these exact reason
 * strings. Those come from reading its source (see _shared/angle-backoff.ts),
 * and the live batch history showed the same ENV: pattern happening for real.
 *
 * Run: pnpm verify:angles-worker
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let pass = 0;
const fails = [];
const check = (label, ok, detail = '') => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fails.push(label);
    console.log(`  FAIL  ${label}${detail ? `   ${detail}` : ''}`);
  }
};

/* ── a clock we control, installed before anything reads the time ─────────── */
const RealDate = Date;
let clock = RealDate.parse('2026-10-30T00:00:00Z');
class FakeDate extends RealDate {
  constructor(...a) {
    if (a.length === 0) super(clock);
    else super(...a);
  }
  static now() { return clock; }
}
globalThis.Date = FakeDate;
const advance = (ms) => { clock += ms; };
const MIN = 60_000;

/* ── the fake audit backend ────────────────────────────────────────────────── */
const backend = { mode: 'ok', pollsBeforeDone: 1, analyzeCalls: 0, jobs: {} };
const JSONR = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace('https://audit.test', '');
  if (backend.mode === 'offline') {
    return new Response('<html>The tunnel is offline</html>', { status: 502, headers: { 'content-type': 'text/html' } });
  }
  if (path.startsWith('/jobs?')) {
    return JSONR(200, Object.values(backend.jobs).map((j) => ({ job_id: j.id, label: j.label })));
  }
  if (path === '/analyze' && init.method === 'POST') {
    if (backend.mode === 'gemini503') return JSONR(503, { detail: 'GEMINI_API_KEY is not set' });
    const body = JSON.parse(init.body);
    backend.analyzeCalls += 1;
    const id = `job${backend.analyzeCalls}`;
    backend.jobs[id] = { id, label: body.label, urls: body.video_urls, polls: 0 };
    return JSONR(202, { job_id: id });
  }
  const m = /^\/jobs\/([^/?]+)/.exec(path);
  if (m) {
    const job = backend.jobs[m[1]];
    if (!job) return JSONR(404, { detail: `no job ${m[1]}` });
    if (backend.mode === 'gemini503') return JSONR(503, { detail: 'GEMINI_API_KEY is not set' });
    job.polls += 1;
    if (job.polls <= backend.pollsBeforeDone) {
      return JSONR(200, { status: 'running', phase: 'phase3', placements: [], unplaced: [] });
    }
    const ok = (u, i) => ({ video: u, angle: i % 2 ? 'Angle B' : 'Angle A', brief: 'Aurelia', needs_review: false, note: null });
    const down = (u) => ({ video: u, reason: 'module_failed' });
    let placements = [];
    let unplaced = [];
    if (backend.mode === 'ok') placements = job.urls.map(ok);
    else if (backend.mode === 'quota') unplaced = job.urls.map(down);
    else if (backend.mode === 'partial') {
      placements = job.urls.slice(0, 3).map(ok);
      unplaced = job.urls.slice(3).map(down);
    } else if (backend.mode === 'review') {
      placements = job.urls.map((u) => ({
        video: u, angle: 'Matched None', brief: null, needs_review: true,
        note: 'no visual evidence: the video was judged on speech and text only',
      }));
    }
    /* module_failed still ends the job as `succeeded`: the machine's own rule. */
    return JSONR(200, { status: 'succeeded', phase: 'done', placements, unplaced, warnings: [], error: null });
  }
  throw new Error(`fake backend: unexpected ${init.method ?? 'GET'} ${path}`);
};

/* ── Deno, the way the worker reads it ─────────────────────────────────────── */
const SECRET = 's'.repeat(40);
const ENV = {
  SUPABASE_URL: 'https://x.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service',
  COLLAB_ANGLES_SYNC_SECRET: SECRET,
  AUDIT_API_URL: 'https://audit.test',
  AUDIT_API_KEY: 'key',
};
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
console.error = () => {}; // the worker logs real failures; the test reads state instead

const mock = await import('./lib/mock-supabase.mjs');
await import('../supabase/functions/collab-angles-sync/index.ts');
if (!handler) throw new Error('the worker did not register a handler');

const { tables } = mock;
const videos = () => tables.collab_angle_videos ?? [];
const batches = () => tables.collab_angle_batches ?? [];
const count = (st) => videos().filter((v) => v.status === st).length;
const angleRow = () => (tables['wurxbase.activity_logs'] ?? [])[0];
const angleVideos = () => (angleRow()?.details?.angles ?? []).flatMap((a) => a.videos);

function seed(n, { brand = 'Aurelia', mode = 'ok', polls = 1 } = {}) {
  clock = RealDate.parse('2026-10-30T00:00:00Z');
  backend.mode = mode;
  backend.pollsBeforeDone = polls;
  backend.analyzeCalls = 0;
  backend.jobs = {};
  mock.reset({
    tables: {
      collab_brand_briefs: [
        { brand, aliases: [], product: brand, brief_url: 'https://docs.test/b', angles: ['Angle A', 'Angle B'], position: 0, is_active: true },
      ],
      collab_angle_videos: Array.from({ length: n }, (_, i) => ({
        id: `00000000-0000-4000-9000-${String(i + 1).padStart(12, '0')}`,
        brand, month: '2026-10',
        video_id: String(7000000000000000000n + BigInt(i)),
        video_url: `https://www.tiktok.com/@u${i}/video/${7000000000000000000n + BigInt(i)}`,
        creator: `Creator ${i}`, status: 'queued', attempts: 0, last_error: null, batch_id: null,
        created_at: new Date(clock + i * 1000).toISOString(),
      })),
    },
  });
}

async function tick() {
  const res = await handler(new Request('https://x.supabase.co/functions/v1/collab-angles-sync', {
    method: 'POST',
    headers: { 'x-sync-secret': SECRET, 'content-type': 'application/json' },
    body: '{}',
  }));
  return res.json();
}
/** One cron firing a minute for `minutes` minutes. */
async function run(minutes) {
  const out = [];
  for (let i = 0; i < minutes; i++) { out.push(await tick()); advance(MIN); }
  return out;
}
const attemptsAll = () => videos().map((v) => v.attempts);

/* ══════════════════════════════════════════════════════════════════════════ */
console.log('\n1. GEMINI IS DOWN (the quota is spent): videos stay queued');
seed(12, { mode: 'quota' });
await run(4); // submit, poll (running), poll (done, all module_failed), idle
check('the first batch went out to the audit machine', backend.analyzeCalls === 1);
check('its five videos came back to the queue, not to "failed"', count('queued') === 12 && count('failed') === 0);
check('and were NOT charged an attempt', attemptsAll().every((a) => a === 0), attemptsAll().join(','));
check('the reason is kept on them, so it can be shown', videos().some((v) => v.last_error === 'module_failed'));
const failed1 = batches().find((b) => b.state === 'done');
check('the batch is marked as an environment failure (ENV:)', !!failed1 && String(failed1.error).startsWith('ENV:'), String(failed1?.error));
const calls = backend.analyzeCalls;
const idle = await tick(); // the minute after the failure, well inside the 5 minute wait
check('the next tick says it is cooling down and does nothing', idle.idle === true && idle.cooling_down_s > 0, JSON.stringify(idle));
advance(MIN);
await run(2);
check('it WAITS: no new batch is sent to a dead service while cooling down', backend.analyzeCalls === calls);
advance(5 * MIN);
const probe = await tick();
check('after the wait it sends ONE probe batch to see whether Gemini is back', probe.made === true && backend.analyzeCalls === calls + 1);

console.log('\n2. A WHOLE DAY OF IT (cron every minute, Gemini dead for 12 hours)');
seed(12, { mode: 'quota' });
const at = [];
for (let i = 0; i < 12 * 60; i++) {
  const before = backend.analyzeCalls;
  await tick();
  if (backend.analyzeCalls > before) at.push(i);
  advance(MIN);
}
check('it kept probing, but only about once an hour at the end (not every minute)',
  backend.analyzeCalls >= 8 && backend.analyzeCalls <= 16, `${backend.analyzeCalls} submissions in 12 hours`);
check('every video is still queued after 12 hours', count('queued') === 12 && count('failed') === 0);
check('none was charged an attempt', attemptsAll().every((a) => a === 0));
const gaps = at.slice(1).map((t, i) => t - at[i]);
check('the gaps between probes grow (5, 10, 20, 40 minutes, then an hour)',
  gaps[gaps.length - 1] >= 55 && gaps[0] < gaps[gaps.length - 1], gaps.join(','));

console.log('\n3. THE QUOTA REFRESHES: it carries on by itself');
const dead = backend.analyzeCalls;
backend.mode = 'ok';
let first = null;
for (let i = 0; i < 4 * 60 && count('filed') < 12; i++) {
  await tick();
  if (first === null && count('filed') > 0) first = i;
  advance(MIN);
}
check('it noticed within an hour, with nobody pressing anything', first !== null && first <= 65, `after ${first} min`);
check('all 12 videos ended up filed in their angles', count('filed') === 12 && angleVideos().length === 12,
  `filed ${count('filed')}, in angles ${angleVideos().length}`);
check('nothing failed along the way', count('failed') === 0);
check('it did not need to keep waiting once Gemini answered',
  backend.analyzeCalls - dead <= 4, `${backend.analyzeCalls - dead} batches for 12 videos`);
check('the waiting marker is gone after a good batch',
  !String(batches().sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0]?.error ?? '').startsWith('ENV:'));

console.log('\n4. THE QUOTA DIES PART WAY THROUGH A BATCH');
seed(5, { mode: 'partial' });
await run(3);
check('the three that were judged are filed', count('filed') === 3 && angleVideos().length === 3);
check('the two that were not are kept (queued or already re-sent), uncharged, not failed',
  count('failed') === 0 && count('queued') + count('sent') === 2 && attemptsAll().every((a) => a === 0),
  `queued ${count('queued')}, sent ${count('sent')}, failed ${count('failed')}`);

console.log('\n5. GEMINI "ANSWERS" BUT CANNOT SEE THE VIDEOS (the needs_review form)');
seed(6, { mode: 'review' });
await run(4);
check('they are not parked as needs_review, and not charged',
  count('needs_review') === 0 && count('queued') === 6 && attemptsAll().every((a) => a === 0),
  `queued ${count('queued')}, review ${count('needs_review')}`);
const calls5 = backend.analyzeCalls;
await run(3);
check('and the worker waits instead of re-sending them', backend.analyzeCalls === calls5);
backend.mode = 'ok';
await run(70);
check('once Gemini can see again they are filed', count('filed') === 6, `filed ${count('filed')}`);

console.log('\n6. A VIDEO THAT FAILS ALONE STILL RUNS OUT OF ATTEMPTS (it must not block the queue)');
seed(1, { mode: 'quota' });
await run(20);
check('a lone video with a model failure ends as failed after 3 tries', count('failed') === 1 && videos()[0].attempts === 3,
  `${videos()[0].status} / ${videos()[0].attempts}`);

console.log('\n7. THE AUDIT MACHINE IS UNREACHABLE (tunnel down, laptop asleep)');
seed(5, { mode: 'ok', polls: 2 });
await run(2); // submitted and running
backend.mode = 'offline';
await run(30);
check('nothing is failed or charged while it is away',
  count('failed') === 0 && attemptsAll().every((a) => a === 0) && count('sent') === 5);
backend.mode = 'ok';
await run(10);
check('when it is back the same batch finishes and is filed', count('filed') === 5, `filed ${count('filed')}`);

console.log('\n8. THE AUDIT SERVICE ANSWERS 503 ("GEMINI_API_KEY not set" and the like)');
seed(5, { mode: 'ok', polls: 3 });
await run(2);
backend.mode = 'gemini503';
await run(20);
check('the batch is held, not failed', count('failed') === 0 && count('sent') === 5 && attemptsAll().every((a) => a === 0));
backend.mode = 'ok';
await run(10);
check('and it finishes once the service is healthy again', count('filed') === 5, `filed ${count('filed')}`);

console.log('\n9. THE CRON ITSELF');
const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261007090000_collab_angle_queue.sql'), 'utf8');
check('it is scheduled every minute', /cron\.schedule\(\s*'collab-angles-cycle',\s*'\* \* \* \* \*'/.test(migration));
check('a stranger without the secret is refused', await (async () => {
  seed(1);
  const r = await handler(new Request('https://x/f', { method: 'POST', body: '{}' }));
  return r.status === 401;
})());

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
