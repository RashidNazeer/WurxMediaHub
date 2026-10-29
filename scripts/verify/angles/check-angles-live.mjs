#!/usr/bin/env node
/**
 * Does the deployed Categorise feature do what it says, against the real dev
 * project?
 *
 *   SUPABASE_SERVICE_KEY=... [COLLAB_ANGLES_SYNC_SECRET=...] node scripts/verify/angles/check-angles-live.mjs
 *
 * WHY THIS EXISTS. check-angles-categorise.mjs proves the source agrees with
 * itself. It cannot prove the deployment is right, and the ways this feature
 * fails are all quiet ones: a brief whose brand matches no creator is never
 * used and nothing says so; a worker that was never deployed leaves the queue
 * full for ever; and a `start` that ignores the angle store queues videos that
 * somebody filed by hand, which only shows up as a month of audit-machine time
 * spent on work already done.
 *
 * READ ONLY. It sends GETs to the REST API and nothing else. It does not queue
 * anything, does not start a batch and never calls the audit machine. The one
 * non-GET is the worker probe, and that is only made when the queue is empty
 * (so the worker has nothing to start) or when `--drive` is passed on purpose.
 *
 * It SKIPs, with a message, when SUPABASE_SERVICE_KEY is not set. Dev only: the
 * project ref is fixed below and never read from the environment.
 */

const REF = 'qinxwfdwvpkzfhcijuqw';
const BASE = `https://${REF}.supabase.co`;
const KEY = process.env.SUPABASE_SERVICE_KEY ?? '';
const SECRET = process.env.COLLAB_ANGLES_SYNC_SECRET ?? '';
const DRIVE = process.argv.includes('--drive');

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
const info = (line) => console.log(`  INFO  ${line}`);
const skip = (line) => console.log(`  SKIP  ${line}`);

if (!KEY) {
  console.log('\nSKIP  set SUPABASE_SERVICE_KEY (the dev service role key) to run the live check.\n');
  process.exit(0);
}

/* Same rule as the Edge Function, so this tests the SAME id and not a lookalike. */
function tiktokVideoId(url) {
  const m = /\/(?:video|photo|v)\/(\d{6,32})/.exec(url ?? '');
  if (m) return m[1];
  const n = /(\d{10,32})/.exec(url ?? '');
  return n ? n[1] : '';
}

/** A GET against PostgREST. The schema is chosen with a header, not a path. */
async function get(table, query = '', schema = 'public') {
  const rows = [];
  /* PostgREST stops at 1000 rows a request; a brand list is small but the
     creators table is not guaranteed to stay under it. */
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${BASE}/rest/v1/${table}${query ? `?${query}` : ''}`, {
      headers: {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        'Accept-Profile': schema,
        Range: `${from}-${from + 999}`,
        'Range-Unit': 'items',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${schema}.${table} answered ${res.status} ${body.slice(0, 160)}`);
    }
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) return rows;
  }
}

const lower = (s) => String(s ?? '').trim().toLowerCase();

/** Every brief's spellings: the brand, then each alias. */
const spellings = (b) => [b.brand, ...(Array.isArray(b.aliases) ? b.aliases : [])].map(lower).filter(Boolean);

/** The month rule from `videosForBrand`: the video's own date, else the hiring month. */
function monthsOf(creators, brand) {
  const byMonth = new Map();
  for (const c of creators) {
    if (String(c.brand ?? '').trim() !== brand) continue;
    const hire = String(c.hiring_date ?? '').slice(0, 7);
    for (const v of Array.isArray(c.video_codes) ? c.video_codes : []) {
      const url = String(v?.video ?? '').trim();
      if (!url) continue;
      const m = String(v?.date ?? '').slice(0, 7) || hire;
      const id = tiktokVideoId(url);
      if (!m || !id) continue;
      if (!byMonth.has(m)) byMonth.set(m, new Set());
      byMonth.get(m).add(id);
    }
  }
  return byMonth;
}

/** Ids filed in any angle of one stored row. `details` is sometimes a JSON string. */
function filedIn(row) {
  let d = row?.details;
  if (typeof d === 'string') {
    try { d = JSON.parse(d); } catch { d = null; }
  }
  const out = new Set();
  for (const a of Array.isArray(d?.angles) ? d.angles : []) {
    for (const v of Array.isArray(a?.videos) ? a.videos : []) {
      const id = tiktokVideoId(String(v));
      if (id) out.add(id);
    }
  }
  return out;
}

console.log(`\nLive check against ${REF} (read only)`);

/* ------------------------------------------------------------------------- */
console.log('\n1. TABLES: both exist and the service key can read them');

let queue = [];
let batches = [];
let briefs = [];
let creators = [];
let angleRows = [];
try {
  queue = await get('collab_angle_videos', 'select=brand,month,video_id,status');
  check('the queue table exists and is readable', true, `${queue.length} row(s)`);
} catch (e) {
  check('the queue table exists and is readable', false, String(e.message ?? e));
}
try {
  batches = await get('collab_angle_batches', 'select=brand,month,state,n_videos,last_phase,attempts,error,created_at&order=created_at.desc&limit=200');
  check('the batch table exists and is readable', true, `${batches.length} row(s)`);
} catch (e) {
  check('the batch table exists and is readable', false, String(e.message ?? e));
}
try {
  briefs = await get('collab_brand_briefs', 'select=brand,aliases,is_active&is_active=eq.true');
  check('the brief table is readable and has active briefs', briefs.length > 0, `${briefs.length} active`);
} catch (e) {
  check('the brief table is readable and has active briefs', false, String(e.message ?? e));
}
try {
  creators = await get('creators', 'select=name,brand,hiring_date,video_codes', 'wurxbase');
  check('wurxbase.creators is readable through the schema header', creators.length > 0, `${creators.length} creator(s)`);
} catch (e) {
  check('wurxbase.creators is readable through the schema header', false, String(e.message ?? e));
}
try {
  angleRows = await get('activity_logs', 'select=target,details&action=eq.CREATIVE_ANGLE', 'wurxbase');
  check('the angle store (wurxbase.activity_logs) is readable', true, `${angleRows.length} brand-month row(s)`);
} catch (e) {
  check('the angle store (wurxbase.activity_logs) is readable', false, String(e.message ?? e));
}

/* ------------------------------------------------------------------------- */
console.log('\n2. BRIEFS: every one of them is reachable from a real brand');

/* A brief is only ever looked up by a brand name that a creator row carries. One
   that matches no creator brand, by its name or by any alias, is never used, and
   nothing anywhere reports it. */
const postingBrands = [...new Set(
  creators
    .filter((c) => (Array.isArray(c.video_codes) ? c.video_codes : []).some((v) => String(v?.video ?? '').trim()))
    .map((c) => String(c.brand ?? '').trim())
    .filter(Boolean),
)].sort();
const allBrands = new Set(creators.map((c) => lower(c.brand)).filter(Boolean));

/* A BRIEF MATCHING NOTHING IS USUALLY FINE, AND SOMETIMES A TYPO, so tell the
   two apart rather than going red for ever.

   A brand that has signed no creators yet has a brief and no rows. That is the
   ordinary state of a brand being set up, and failing on it would leave this
   suite permanently red and therefore ignored. A brief whose name is a NEAR
   MISS of a real brand is the other thing entirely: it will silently never be
   used, and that is the failure this file exists to catch. */
const squash = (s) => lower(s).replace(/[^a-z0-9]/g, '');
const squashed = new Map([...allBrands].map((b) => [squash(b), b]));
const orphans = briefs.filter((b) => !spellings(b).some((s) => allBrands.has(s)));
const typos = orphans.filter((b) => spellings(b).some((s) => squashed.has(squash(s))));
const unsigned = orphans.filter((b) => !typos.includes(b));

check('no brief is a near miss of a real brand name, which would never match',
  typos.length === 0,
  typos.map((b) => `"${b.brand}" looks like "${
    squashed.get(squash(spellings(b).find((s) => squashed.has(squash(s))) ?? '')) ?? '?'}"`).join('; '));
if (unsigned.length) {
  info(`${unsigned.length} brief(s) are for brands with no creators yet. That is fine, ` +
    `and they start working the day a creator posts: ${unsigned.map((b) => b.brand).join(', ')}`);
}

const covered = new Set(briefs.flatMap(spellings));
const unbriefed = postingBrands.filter((b) => !covered.has(lower(b)));
if (unbriefed.length) {
  info(`${unbriefed.length} brand(s) post videos but have no brief, so Categorise refuses them: ${unbriefed.join(', ')}`);
} else {
  info('every brand that posts videos has a brief');
}

/* ------------------------------------------------------------------------- */
console.log('\n3. WORKER: deployed, guarded, and answering');

const WORKER = `${BASE}/functions/v1/collab-angles-sync`;
try {
  const bare = await fetch(WORKER, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(30_000),
  });
  /* 404 here is the case worth naming: a worker never deployed looks, from the
     cron history, exactly like one that is simply idle. */
  check('the worker is deployed and refuses a call with no secret (401)',
    bare.status === 401, `answered ${bare.status}`);
} catch (e) {
  check('the worker is deployed and refuses a call with no secret (401)', false, String(e));
}

const open = queue.filter((r) => r.status === 'queued' || r.status === 'sent').length;
if (!SECRET) {
  skip('set COLLAB_ANGLES_SYNC_SECRET to check the worker accepts the right secret');
} else if (open > 0 && !DRIVE) {
  /* With the right secret the worker acts: it would start sending these to the
     audit machine. This script promised not to, so it asks first. */
  skip(`${open} video(s) are waiting, so an authorised call would start real work; pass --drive to allow it`);
} else {
  try {
    const res = await fetch(WORKER, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-secret': SECRET },
      body: '{}',
      signal: AbortSignal.timeout(60_000),
    });
    const kind = res.headers.get('content-type') ?? '';
    const body = kind.includes('json') ? await res.json().catch(() => null) : null;
    /* Busy, idle and offline are all healthy: the answer is JSON and 200. */
    check('the worker accepts the right secret and answers JSON (200)',
      res.status === 200 && body !== null, `answered ${res.status} ${kind}`);
    if (body) info(`worker said: ${JSON.stringify(body).slice(0, 160)}`);
  } catch (e) {
    check('the worker accepts the right secret and answers JSON (200)', false, String(e));
  }
}

/* ------------------------------------------------------------------------- */
console.log('\n4. NEW ONLY: what angles.start should call new, against the real data');

/* Pick the brand and month where the answer is most telling: a brief exists, the
   brand posted that month, and the angle store already holds some of it. Failing
   that, any month with videos. Without a filed video there is nothing to prove. */
const filedByTarget = new Map(angleRows.map((r) => [String(r.target), filedIn(r)]));
let pick = null;
for (const b of briefs) {
  for (const brand of postingBrands.filter((p) => spellings(b).includes(lower(p)))) {
    for (const [month, ids] of monthsOf(creators, brand)) {
      const filed = filedByTarget.get(`${brand}::${month}`) ?? new Set();
      const hit = [...ids].filter((i) => filed.has(i)).length;
      if (!pick || hit > pick.hit || (hit === pick.hit && ids.size > pick.ids.size)) {
        pick = { brand, month, ids, filed, hit };
      }
    }
  }
}

if (!pick) {
  skip('no brand has both a brief and posted videos, so there is nothing to compute');
} else {
  const { brand, month, ids, filed } = pick;
  const total = ids.size;
  const categorised = [...ids].filter((i) => filed.has(i));
  const unfiled = [...ids].filter((i) => !filed.has(i));
  info(`checking ${brand} for ${month}: ${total} video(s), ${categorised.length} already in an angle, ${unfiled.length} new`);

  check('every video is either already categorised or new, never both and never neither',
    categorised.length + unfiled.length === total && categorised.length <= total,
    `${categorised.length} + ${unfiled.length} != ${total}`);

  const rows = queue.filter((r) => r.brand === brand && r.month === month);
  const queuedIds = new Set(rows.map((r) => String(r.video_id)));

  check('the queue holds only videos this brand posted that month',
    [...queuedIds].every((i) => ids.has(i)),
    `${[...queuedIds].filter((i) => !ids.has(i)).length} queue row(s) are not in the brand month`);

  const wasted = rows.filter((r) =>
    (r.status === 'queued' || r.status === 'sent') && filed.has(String(r.video_id)));
  check('no video already filed by hand is waiting to be sent to the machine',
    wasted.length === 0,
    `${wasted.length} filed video(s) still queued or sent; pressed before the fix, the worker will discard them as duplicates`);

  /* What a press would queue now: new videos the queue has not seen. */
  const wouldQueue = unfiled.filter((i) => !queuedIds.has(i)).length;
  const alreadyQueued = unfiled.length - wouldQueue;
  info(`a press of Categorise now would queue ${wouldQueue}, with ${alreadyQueued} already queued and ${categorised.length} already categorised`);

  if (total && categorised.length === total) {
    info(`the screen would say "All ${total} videos are already categorised."`);
  }
  check('a press would queue no more than the new videos',
    wouldQueue <= unfiled.length && wouldQueue + alreadyQueued + categorised.length === total);
}

/* ------------------------------------------------------------------------- */
console.log('\n5. STATE: for information, not pass or fail');

const tally = {};
for (const r of queue) tally[r.status] = (tally[r.status] ?? 0) + 1;
info(`queue: ${queue.length} row(s) ${Object.keys(tally).length ? JSON.stringify(tally) : ''}`.trim());
const live = batches.filter((b) => ['submitting', 'running', 'filing'].includes(b.state));
const done = batches.filter((b) => b.state === 'done').length;
const failed = batches.filter((b) => b.state === 'failed').length;
info(`batches: ${batches.length} recent, ${live.length} in flight, ${done} done, ${failed} failed`);
for (const b of live) {
  info(`in flight: ${b.brand} ${b.month} is ${b.state}${b.last_phase ? ` (${b.last_phase})` : ''}, ${b.n_videos} video(s)`);
}
for (const b of batches.filter((x) => x.state === 'failed').slice(0, 3)) {
  info(`last failure: ${b.brand} ${b.month}: ${String(b.error ?? 'no message').slice(0, 120)}`);
}

console.log(`\n${pass} passed, ${fails.length} failed.\n`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
