#!/usr/bin/env node
/**
 * Does the Categorise queue screen hold together with the function behind it?
 *
 * No credentials and no browser: the failures this catches are the quiet ones.
 * A screen that sends `queue.remove_group` to a function that spells it
 * `queue.removeGroup` answers "Bad request" at run time, on the one button
 * somebody pressed, and nothing at build time says so.
 *
 *   ACTIONS    every action the screen sends is one the function accepts, and
 *              the reverse
 *   SAFETY     the queue is behind the staff check, a video that is with the
 *              audit machine is never removable, finished history is read only,
 *              and the screen never reaches the database itself
 *   WIRING     the Categorise button opens the queue, the queue is mounted so
 *              its count stays current, and every status can be filtered to
 *
 * Run: pnpm verify:angles-queue
 */
import { readFileSync } from 'node:fs';
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

const fn = read('supabase/functions/collab-angles/index.ts');
const queue = read('src/routes/admin/collab-angle-queue.tsx');
const button = read('src/routes/admin/collab-angle-categorise.tsx');
const api = read('src/routes/admin/collab-angles-api.ts');

console.log('\n1. ACTIONS: the screen and the function agree');
const accepted = new Set([...fn.matchAll(/z\.literal\('(queue\.[a-z_]+)'\)/g)].map((m) => m[1]));
const sent = new Set([...queue.matchAll(/action: '(queue\.[a-z_]+)'/g)].map((m) => m[1]));
check('the function accepts six queue actions', accepted.size === 6, [...accepted].join(', '));
for (const a of sent) check(`the screen sends ${a}, which the function accepts`, accepted.has(a));
for (const a of accepted) check(`the function's ${a} has a button on the screen`, sent.has(a));
check('every accepted action is handled', [...accepted].every((a) => fn.includes(`case '${a}'`)));

console.log('\n2. SAFETY');
const staffAt = fn.indexOf("!STAFF.includes(String(actor?.role))");
const queueAt = fn.indexOf("body.action.startsWith('queue.')");
check('the queue actions sit AFTER the staff check', staffAt > 0 && queueAt > staffAt);
const removable = /const REMOVABLE = \[([^\]]*)\]/.exec(fn)?.[1] ?? '';
check('removing never touches a video with the audit machine', !removable.includes("'sent'"), removable);
check('removing never touches filed or skipped history',
  !removable.includes("'filed'") && !removable.includes("'skipped'"), removable);
const retryable = /const RETRYABLE = \[([^\]]*)\]/.exec(fn)?.[1] ?? '';
check('retrying only touches failed and flagged videos',
  retryable.includes("'failed'") && retryable.includes("'needs_review'") && !retryable.includes("'queued'") &&
    !retryable.includes("'sent'"), retryable);
check('removal is filtered by status in the database, not only on the screen',
  /\.delete\(\)\s*\.in\('id', body\.ids\)\.in\('status', REMOVABLE\)/.test(fn) &&
    /\.delete\(\)\s*\.eq\('brand', body\.brand\)\.eq\('month', body\.month\)\.in\('status', REMOVABLE\)/.test(fn));
check('ids are UUIDs and capped', /ids: z\.array\(z\.uuid\(\)\)\.min\(1\)\.max\(200\)/.test(fn));
check('no queue action accepts a video link from the browser',
  !/queue\.[a-z_]+'\),[^}]*video_url/.test(fn.slice(fn.indexOf('const Body'), fn.indexOf('/** A brief row'))));
check('every edit writes the audit log', (fn.match(/await audit\(/g) ?? []).length >= 4);
check('the history is listed apart from the pending list, so it cannot push waiting videos off the end',
  /\.in\('status', PENDING\)/.test(fn) && /\.in\('status', DONE\)/.test(fn));
check('the screen never builds a Supabase client', !/getSupabase|createClient/.test(queue));
check('the screen reaches the function only through the shared helper',
  /from '\.\/collab-angles-api'/.test(queue) && /functions\.invoke\('collab-angles'/.test(api));
check('the screen removes only statuses the function allows',
  /const REMOVABLE: Status\[\] = \['queued', 'failed', 'needs_review'\]/.test(queue));

console.log('\n3. WIRING: the Categorise button opens the queue');
check('the button opens the queue instead of starting a run', /onClick=\{\(\) => setQueueOpen\(true\)\}/.test(button));
check('the button is no longer disabled while a run is in flight', !/disabled=\{busy\}/.test(button));
check('starting a run is the first action inside the queue',
  /onStart=\{start\}/.test(button) && /onClick=\{start\}/.test(queue));
check('the queue is mounted always, so its count stays current', /<CollabAngleQueue\s+open=\{queueOpen\}/.test(button));
check('the button shows the count', /queueCount > 0/.test(button));
for (const s of ['queued', 'sent', 'failed', 'needs_review', 'filed', 'skipped']) {
  check(`the status "${s}" can be filtered to`, new RegExp(`${s}: '[A-Za-z ]+',`).test(queue));
}
check('there is an "All" chip', /\['all', \.\.\.STATUSES\]/.test(queue));
check('the dialog is portalled out of the vendored root', /createPortal\(/.test(queue));
check('the dialog explains a pause and why', /plainReason/.test(queue) && /wait_reason/.test(fn));
check('no hardcoded hex colour in the screen', !/#[0-9a-fA-F]{3,8}\b/.test(queue));
check('every type size is a rem', !/text-\[[0-9.]+px\]/.test(queue));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
