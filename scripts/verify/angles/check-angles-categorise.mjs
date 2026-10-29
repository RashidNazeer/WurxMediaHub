#!/usr/bin/env node
/**
 * Does the Categorise feature hold together?
 *
 * Three kinds of check, and the first two need no credentials at all, which is
 * the point: the failures this catches are the silent ones.
 *
 *   WIRING    the SQL, the Edge Functions and the screen have to agree about
 *             table names, column names and the exact status strings. Nothing
 *             enforces that at build time: a worker writing `state = 'filing'`
 *             into a column whose CHECK does not list it fails at run time, in
 *             a cron job nobody is watching, on the one row it was given.
 *   PLATFORM  the things that fail quietly when forgotten. A missing
 *             `verify_jwt = false` block means pg_cron's call gets 401 for
 *             ever while the cron history looks perfectly healthy.
 *   LIVE      with AUDIT_API_URL and AUDIT_API_KEY set, that the audit machine
 *             is reachable and still answers in the shape the worker reads.
 *
 * Run: pnpm verify:angles-categorise
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = (p) => readFileSync(join(root, p), 'utf8');

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

const MIGRATION = 'supabase/migrations/20261007090000_collab_angle_queue.sql';
const BRIEFS = 'supabase/migrations/20261006090000_collab_brand_briefs.sql';
const FN = 'supabase/functions/collab-angles/index.ts';
const WORKER = 'supabase/functions/collab-angles-sync/index.ts';
const API = 'supabase/functions/_shared/audit-api.ts';
const STORE = 'supabase/functions/_shared/angle-store.ts';
const UI = 'src/routes/admin/collab-angle-categorise.tsx';
const SCREEN = 'src/vendor/wurxbase/CreativeAngles.jsx';

console.log('\n1. WIRING: the SQL and the code agree');

const sql = read(MIGRATION);
const worker = read(WORKER);
const fn = read(FN);

/* Every status string the code writes must be allowed by the CHECK that
   guards the column, or the write fails at run time inside a cron job. */
const videoStatuses = [...new Set(
  [...worker.matchAll(/status:\s*'([a-z_]+)'/g)].map((m) => m[1])
    .concat([...fn.matchAll(/status:\s*'([a-z_]+)'/g)].map((m) => m[1]))
    .concat([...worker.matchAll(/\.eq\('status',\s*'([a-z_]+)'\)/g)].map((m) => m[1])),
)];
const videoCheck = /check \(status in \(([^)]*)\)\)/.exec(sql)?.[1] ?? '';
for (const s of videoStatuses) {
  check(`video status '${s}' is allowed by the CHECK`, videoCheck.includes(`'${s}'`), videoCheck);
}

const batchStates = [...new Set(
  [...worker.matchAll(/state:\s*'([a-z_]+)'/g)].map((m) => m[1])
    .concat([...worker.matchAll(/'(submitting|running|filing|done|failed|queued)'/g)].map((m) => m[1])),
)];
const stateCheck = /check \(state in \(([^)]*)\)\)/.exec(sql)?.[1] ?? '';
for (const s of batchStates) {
  check(`batch state '${s}' is allowed by the CHECK`, stateCheck.includes(`'${s}'`), stateCheck);
}

/* A column the code reads or writes that the table does not have. */
const columns = {
  collab_angle_videos: ['brand', 'month', 'video_id', 'video_url', 'creator', 'status',
    'angle', 'brief_label', 'batch_id', 'attempts', 'last_error', 'filed_at'],
  collab_angle_batches: ['brand', 'month', 'state', 'provider_job', 'n_videos', 'attempts',
    'lease_until', 'last_phase', 'last_polled_at', 'submitted_at', 'finished_at', 'error'],
};
for (const [table, cols] of Object.entries(columns)) {
  const body = sql.slice(sql.indexOf(`create table if not exists public.${table}`));
  const decl = body.slice(0, body.indexOf(');'));
  const missing = cols.filter((c) => !new RegExp(`^\\s+${c}\\s`, 'm').test(decl));
  check(`${table} declares every column the code uses`, missing.length === 0, missing.join(', '));
}

/* The briefs the worker sends come from the other migration's columns. */
check('collab_brand_briefs has the columns the worker selects',
  ['brand', 'aliases', 'product', 'brief_url', 'angles'].every((c) =>
    new RegExp(`^\\s+${c}\\s`, 'm').test(read(BRIEFS))));

check('the queue table is unique per brand, month and video',
  /unique \(brand, month, video_id\)/.test(sql));
check('a batch losing its row does not delete its videos',
  /references public\.collab_angle_batches \(id\) on delete set null/.test(sql));

console.log('\n2. PLATFORM: the things that fail silently');

const config = read('supabase/config.toml');
check('collab-angles keeps the JWT gate on',
  /\[functions\.collab-angles\]\s*\nverify_jwt = true/.test(config));
check('collab-angles-sync turns it off, or pg_cron gets 401 for ever',
  /\[functions\.collab-angles-sync\]\s*\nverify_jwt = false/.test(config));

check('both tables grant to service_role, or the worker sees nothing',
  (sql.match(/grant all privileges on table public\.collab_angle_\w+\s+to service_role;/g) ?? []).length === 2);
check('both tables have RLS on', (sql.match(/enable row level security/g) ?? []).length === 2);
check('neither table lets a browser write',
  !/for (insert|update|delete)/.test(sql));
check('reads are gated on is_collabs_viewer()',
  (sql.match(/using \(public\.is_collabs_viewer\(\)\)/g) ?? []).length === 2);

check('the cron job is scheduled every minute',
  /cron\.schedule\(\s*'collab-angles-cycle',\s*'\* \* \* \* \*'/.test(sql));
check('the cycle returns null rather than raising when the vault is empty',
  /if v_secret is null or v_url is null then\s*\n\s*return null;/.test(sql));
check('the cycle sends the shared secret', /'x-sync-secret', v_secret/.test(sql));

console.log('\n3. THE SEAM: our button is in their screen, and survives a re-vendor');

const screen = read(SCREEN);
check('CreativeAngles.jsx imports our component',
  /import \{ CollabAngleCategorise \} from '@\/routes\/admin\/collab-angle-categorise'/.test(screen));
check('the button is rendered in the header', /<CollabAngleCategorise/.test(screen));
check('both of our blocks are fenced',
  (screen.match(/WURX-ADDED/g) ?? []).length >= 2 &&
  (screen.match(/WURX-END/g) ?? []).length >= 2);
const patches = read('scripts/ops/wurxbase/wurxbase-patches.mjs');
check('the patch script can re-apply them after a re-vendor',
  patches.includes('CreativeAngles.jsx'));
check('the vendored file still holds no Supabase client',
  !/createClient\(/.test(screen) && !/@\/lib\/supabase/.test(screen));

console.log('\n4. SAFETY: the rules that protect work people did by hand');

const store = read(STORE);
check('filing conditions its write on the revision it read',
  /\.eq\('revision', expected\)/.test(store));
check('filing bumps the revision, or a stale tab overwrites it',
  /revision: expected \+ 1/.test(store));
check('filing never deletes', !/\.delete\(\)/.test(store));
check('filing never writes an empty angle list',
  /if \(!filed\.length && !created\.length\)/.test(store));
check('a video already filed by hand is left alone',
  /alreadyFiled/.test(store) && /filedIds/.test(store));
check('videos are matched by TikTok id, not by comparing links',
  /tiktokVideoId/.test(store) && /tiktokVideoId/.test(worker));
check('a placement the machine is unsure of is not filed',
  /needs_review/.test(worker) && /confident/.test(worker));

const api = read(API);
check('an offline tunnel is told apart from a refusal',
  /class AuditOffline/.test(api) && /class AuditRefused/.test(api));
check('a non-JSON reply counts as offline, not as a missing job',
  /ngrok-error-code/.test(api) && /includes\('json'\)/.test(api));
check('every request carries the key and the ngrok header',
  /'x-api-key'/.test(api) && /'ngrok-skip-browser-warning'/.test(api));
check('a submit can recover a reply that was lost',
  /findJobByLabel/.test(api) && /findJobByLabel/.test(worker));
check('the worker never trusts a result before the job is terminal',
  /terminal/.test(api) && /job\.terminal/.test(worker));
check('the browser never supplies the video list',
  /videosForBrand/.test(fn) && !/video_urls/.test(read(UI)));

console.log('\n5. NEW ONLY: a video already filed is never sent to the machine again');

/* The bug this section pins: angles.start used to look only at its own queue
   table, so a month somebody had filed by hand (Biostime: 59 videos in 3 angles)
   was queued whole and sent to the audit machine at about five minutes a video,
   to be discarded as duplicates at filing time. Nothing errored. It was just
   slow and wasteful, which is exactly why a test has to say so. */
const ui = read(UI);
const start = fn.slice(fn.indexOf('angles.start ──'));
const progress = fn.slice(fn.indexOf('async function progressOf'), fn.indexOf('Deno.serve'));
const importsStore = /import\s*\{[^}]*\bfiledVideoIds\b[^}]*\}\s*from\s*'\.\.\/_shared\/angle-store\.ts'/.test(fn);

check('the angle store can be asked which videos are already filed',
  /export\s+(async\s+)?(const|function)\s+filedVideoIds\b/.test(store));
check('angles.start asks the angle store, not only its own queue, what is new',
  importsStore && /filedVideoIds\(/.test(fn) && /monthOf\(/.test(start));
check('a video already filed by hand is not put in the queue',
  /filed\.has\(/.test(fn) && /fresh/.test(start) && /collab_angle_videos/.test(start));
check('the filed check comes before the queue check, so no video is counted twice',
  /filed\.has\([^)]*\)[\s\S]*?known\.has\(/.test(start));
check('the queue and the angle store are compared by TikTok id, not by link text',
  /tiktokVideoId\(/.test(fn) && /video_id/.test(fn) && /filedIds\(/.test(store));
check('the screen is told how many videos the brand posted, on start and on progress',
  (start.match(/total_videos/g) ?? []).length >= 2 && /total_videos/.test(progress));
check('the screen is told how many are already categorised, on start and on progress',
  (start.match(/already_categorised/g) ?? []).length >= 2 && /already_categorised/.test(progress));
check('the progress ring still counts queue rows, not every video of the month',
  /const total = \(data \?\? \[\]\)\.length/.test(progress));
check('a month nobody has started reads as an empty set, not as an error',
  /return filedIds\(anglesOf\(row\)\)/.test(store) && /Array\.isArray\(list\) \? list/.test(store));
check('the screen reads both totals from the reply',
  /total_videos/.test(ui) && /already_categorised/.test(ui));
check('the screen says so when every video is already categorised',
  /already categorised/i.test(ui) && /All \$\{[^}]+\} are already categorised/.test(ui));
check('the screen says so when the brand posted nothing that month',
  /No videos posted for/.test(ui));
check('a person never reads a dash in the message',
  !/[–—]/.test((ui.match(/return `[^`]*`/g) ?? []).join('\n')));

console.log('\n6. LIVE: the audit machine, if this run can reach it');

const url = (process.env.AUDIT_API_URL ?? '').replace(/\/+$/, '');
const key = process.env.AUDIT_API_KEY ?? '';
if (!url || !key) {
  console.log('  SKIP  set AUDIT_API_URL and AUDIT_API_KEY to check the machine itself');
} else {
  const headers = { 'x-api-key': key, 'ngrok-skip-browser-warning': '1' };
  try {
    const res = await fetch(`${url}/ready`, { headers, signal: AbortSignal.timeout(20_000) });
    const kind = res.headers.get('content-type') ?? '';
    check('the machine answers with JSON, not the tunnel error page',
      kind.includes('json') && !res.headers.get('ngrok-error-code'), kind);
    const body = await res.json();
    check('it reports itself ready', body?.ready === true, JSON.stringify(body?.problems ?? []));
    const missing = await fetch(`${url}/jobs/doesnotexist0000`, { headers, signal: AbortSignal.timeout(20_000) });
    const mj = await missing.json().catch(() => ({}));
    check('a missing job is a JSON 404, so it cannot be mistaken for an outage',
      missing.status === 404 && /no job/i.test(String(mj?.detail ?? '')));
  } catch (err) {
    check('the machine is reachable', false, String(err));
  }
}

console.log(`\n${pass} passed, ${fails.length} failed.\n`);
if (fails.length) {
  for (const f of fails) console.log(`  - ${f}`);
  process.exit(1);
}
if (!existsSync(join(root, MIGRATION))) process.exit(1);
