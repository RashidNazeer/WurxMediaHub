#!/usr/bin/env node
/**
 * Does the categoriser stop burning videos when the environment fails?
 *
 * Needs no credentials and no Deno: the decisions live in
 * `supabase/functions/_shared/angle-backoff.ts`, which has no imports, so this
 * runs the real code. The last section reads the worker as text to prove it
 * actually uses those decisions, because a rule nobody calls protects nothing.
 *
 * The reason strings in sections 1 and 3 are the audit machine's own, taken
 * from audit-backend/Backend (pipeline.py, jobs.py, ingest.py), not invented.
 *
 * Run: pnpm verify:angles-backoff
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASE_COOLDOWN_MS,
  MAX_COOLDOWN_MS,
  causeOf,
  chargesAttempt,
  cooldownLeft,
  cooldownMs,
  describeDetail,
  envError,
  environmentalFailure,
  isEnvError,
} from '../../../supabase/functions/_shared/angle-backoff.ts';

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

const MIN = 60_000;

console.log("\n1. WHAT A REASON IS ABOUT (the audit machine's own strings)");
check('module_failed (the unplaced reason) is the model', causeOf('module_failed') === 'model');
check('a Gemini quota error is the model', causeOf('429 RESOURCE_EXHAUSTED: quota exceeded') === 'model');
check('needs_review note "no visual evidence" is the model',
  causeOf('no visual evidence: the video was judged on speech and text only') === 'model');
check('needs_review note "angle judgement returned nothing" is the model',
  causeOf('the angle judgement returned nothing for this video') === 'model');
check('"not judged against every brief" is the model',
  causeOf('not judged against every brief: rate limit') === 'model');
check('"could not download this link" is the source',
  causeOf('could not download this link') === 'source');
check('the job error when nothing downloads is the source',
  causeOf('IngestError: no video could be downloaded. TikTok often refuses anonymous requests ' +
    'from a datacentre IP -- set AUDITOR_COOKIES_FILE to a cookies.txt') === 'source');
check('a brief that will not compile is NOT environmental (it is about the brand)',
  causeOf('IngestError: the brief did not compile: [BACKEND_FAILED]') === 'video');
check('an unknown reason is the video', causeOf('video is 0 seconds long') === 'video');
check('null is the video', causeOf(null) === 'video');

console.log('\n2. WHO IS CHARGED AN ATTEMPT');
check('quota dead in a batch of five: NOT charged', !chargesAttempt('module_failed', 5));
check('a LONE video with module_failed IS charged, so it cannot block the queue for ever',
  chargesAttempt('module_failed', 1));
check('a lone video that will not download is charged',
  chargesAttempt('could not download this link', 1));
check('five downloads refused together: NOT charged',
  !chargesAttempt('could not download this link', 5));
check('a video-specific reason is charged in a batch of five',
  chargesAttempt('video is 0 seconds long', 5));

console.log('\n3. WHEN THE WHOLE BATCH IS ENVIRONMENTAL');
const none = { confidentCount: 0, nVideos: 5 };
check('five module_failed: environmental',
  environmentalFailure(Array(5).fill('module_failed'), none) === 'module_failed');
check('quota dying as needs_review PLACEMENTS is environmental too (a first draft missed this)',
  environmentalFailure([
    'no visual evidence: the video was judged on speech and text only',
    'the angle judgement returned nothing for this video',
    'no visual evidence: the video was judged on speech and text only',
    'module_failed',
    'module_failed',
  ], none) !== null);
check('one different reason breaks it',
  environmentalFailure(['module_failed', 'video is 0 seconds long'], { confidentCount: 0, nVideos: 2 }) === null);
check('any confidently placed video means it is not',
  environmentalFailure(['module_failed'], { confidentCount: 1, nVideos: 2 }) === null);
check('a lone video is never a cooldown (it cannot be told from a bad video)',
  environmentalFailure(['module_failed'], { confidentCount: 0, nVideos: 1 }) === null);
check('no reasons is not environmental', environmentalFailure([], none) === null);

console.log('\n4. THE WAIT');
check('no failures, no wait', cooldownMs(0) === 0);
check('1st: 5 minutes', cooldownMs(1) === 5 * MIN);
check('2nd: 10 minutes', cooldownMs(2) === 10 * MIN);
check('3rd: 20 minutes', cooldownMs(3) === 20 * MIN);
check('it stops growing at an hour', cooldownMs(9) === MAX_COOLDOWN_MS && MAX_COOLDOWN_MS === 60 * MIN);
check('BASE is 5 minutes', BASE_COOLDOWN_MS === 5 * MIN);

const now = Date.parse('2026-10-30T12:00:00Z');
const at = (minsAgo, error) => ({ finished_at: new Date(now - minsAgo * MIN).toISOString(), error });
const ENV = envError('module_failed');

check('envError carries the marker', isEnvError(ENV) && !isEnvError('module_failed'));
check('no batches yet: no wait', cooldownLeft([], now) === 0);
check('last batch fine: no wait', cooldownLeft([at(1, null)], now) === 0);
check('one environmental failure 1 min ago: 4 minutes left',
  cooldownLeft([at(1, ENV)], now) === 4 * MIN);
check('one environmental failure 6 min ago: wait is over',
  cooldownLeft([at(6, ENV)], now) === 0);
check('two in a row: the longer wait applies',
  cooldownLeft([at(1, ENV), at(8, ENV)], now) === 9 * MIN);
check('a success after failures clears it (newest first)',
  cooldownLeft([at(1, null), at(8, ENV), at(20, ENV)], now) === 0);
check('an older success does not hide a newer failure',
  cooldownLeft([at(1, ENV), at(30, null)], now) === 4 * MIN);
check('a garbled timestamp does not wedge the queue',
  cooldownLeft([{ finished_at: 'not a date', error: ENV }], now) === 0);

console.log('\n5. A QUOTA THAT STAYS DEAD ALL DAY (simulated, one tick a minute)');
{
  /* 167 videos, a dead quota. Mirrors the worker: a batch of five (a lone tail
     video is charged, like any video that fails alone). */
  const attempts = Array(167).fill(0);
  const log = [];
  let batches = 0;
  for (let t = 0; t < 24 * 60 * MIN; t += MIN) {
    if (cooldownLeft(log, now + t) > 0) continue;
    const queued = attempts.map((a, i) => [a, i]).filter(([a]) => a < 3).slice(0, 5);
    if (!queued.length) break;
    batches += 1;
    const n = queued.length;
    for (const [, i] of queued) if (chargesAttempt('module_failed', n)) attempts[i] += 1;
    const why = environmentalFailure(queued.map(() => 'module_failed'), { confidentCount: 0, nVideos: n });
    log.unshift({ finished_at: new Date(now + t).toISOString(), error: why ? envError(why) : null });
  }
  const lost = attempts.filter((a) => a >= 3).length;
  check('a dead day fails at most the one lone tail video, never the queue', lost <= 1, `${lost} failed`);
  /* 5+10+20+40 minutes of ramp, then one probe an hour: about 27 in a day. Each
     probe is a failed batch on the audit machine (CPU, almost no quota). */
  check('a dead day costs about one probe an hour', batches >= 20 && batches <= 30, `${batches} batches`);
}

console.log('\n6. THE 422 REASON');
check('a string detail is kept', describeDetail('no job x') === 'no job x');
check('a FastAPI list becomes field and message',
  describeDetail([{ loc: ['body', 'briefs', 0, 'label'], msg: 'String should have at most 80 characters' }]) ===
    'briefs.0.label: String should have at most 80 characters');
check('several are joined',
  describeDetail([{ loc: ['body', 'a'], msg: 'x' }, { loc: ['body', 'b'], msg: 'y' }]) === 'a: x; b: y');
check('nothing usable gives null', describeDetail(undefined) === null && describeDetail([]) === null);

console.log('\n7. THE WORKER USES ALL OF THIS');
const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
const worker = read('supabase/functions/collab-angles-sync/index.ts');
const api = read('supabase/functions/_shared/audit-api.ts');
check('the worker imports the backoff rules', /from '\.\.\/_shared\/angle-backoff\.ts'/.test(worker));
check('a new batch waits out the cooldown (tick start and follow-up)',
  (worker.match(/await waitLeft\(db\)/g) ?? []).length === 2);
check('unplaced videos are charged through chargesAttempt', /chargesAttempt\(u\.reason, nVideos\)/.test(worker));
check('needs_review notes feed the environment test',
  /toFile\.filter\(\(t\) => t\.review\)\.map\(\(t\) => t\.note\)/.test(worker));
check('an environmental needs_review is not charged', /requeueVideos\(db, free, '', \(\) => false\)/.test(worker));
check('a whole-batch failure is marked ENV', /envError\(environment\)/.test(worker));
check('the brief label is cut to 80', /\.slice\(0, LABEL_MAX\)/.test(worker) && /LABEL_MAX = 80/.test(worker));
check('a refusal no longer re-queues for free',
  !/dead = attempts >= MAX_ATTEMPTS \|\| err instanceof AuditRefused/.test(worker));
check('a refusal charges the videos unless it is our key',
  /requeueBatch\(db, batch\.id, message, !config\)/.test(worker));
check('the audit queue being full is a wait, not a failure', /err\.status === 429/.test(worker));
check('a needs_review video is retried once', /Number\(t\.row\.attempts \?\? 0\) < 1/.test(worker));
check('being offline too long is surfaced', /MAX_OFFLINE_MS/.test(worker));
check('audit-api reads a list detail', /describeDetail\(detail\?\.detail\)/.test(api));
check('the worker writes only statuses the table allows',
  [...worker.matchAll(/status: [^'\n]*'([a-z_]+)'/g)].every((m) =>
    ['queued', 'sent', 'filed', 'skipped', 'failed', 'needs_review'].includes(m[1])));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
