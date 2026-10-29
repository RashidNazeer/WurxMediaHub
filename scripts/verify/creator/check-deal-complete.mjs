#!/usr/bin/env node
/**
 * A FINISHED DEAL MOVES ITSELF TO PAYMENT PENDING.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-deal-complete.mjs
 *
 * Rashid, 2026-09-29: "for irwin when a deal is completed such as a creator has
 * made 5/5 videos why does not it automatically move towards payment pending,
 * asad did it manually".
 *
 * Because `reacher-sync` wrote `video_codes` and nothing else. The status on
 * screen is DERIVED from the `videos` flag, and both browser paths that write
 * videos recompute that flag from the deal on every save — the EUKA merge and
 * the video editor. The Edge Function never did, so a creator whose videos
 * arrive from Reacher finished their deal and sat in "Videos in Progress" until
 * a human noticed. Irwin is the only brand Reacher fills, which is exactly why
 * it is the only brand where Asad was doing it by hand.
 *
 * ── WHAT THIS FILE IS REALLY GUARDING ────────────────────────────────────
 * The rule is "enough videos delivered against what the deal promised", and
 * that promise is read out of a free-text string like "$200 / 5 videos" by
 * `parseDealVideos`, which now exists TWICE — once in the browser, once in
 * Deno. Two copies of a rule that decides whether somebody is owed money is a
 * drift waiting to happen, and a drift here is silent: a creator simply never
 * appears in the pending list. So the first half of this file runs BOTH copies
 * over every deal string that actually exists and refuses to let them differ.
 *
 * Nothing is written. It reads the database and the two source files.
 */
import { readFileSync } from 'node:fs';

const URL_ = (process.env.SUPABASE_URL
  || (() => {
    const t = readFileSync('.env.local', 'utf8').match(/^VITE_SUPABASE_URL=(.*)$/m);
    return t ? t[1].trim() : '';
  })());
const KEY = process.env.SUPABASE_SERVICE_KEY;
const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

if (!KEY) {
  console.error('SUPABASE_SERVICE_KEY must be set');
  process.exit(1);
}
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Accept-Profile': 'wurxbase' };
async function all(path) {
  const out = [];
  for (let f = 0; ; f += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${path}`, { headers: { ...H, Range: `${f}-${f + 999}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const j = await r.json(); out.push(...j); if (j.length < 1000) break;
  }
  return out;
}

/* ── 1. THE TWO PARSERS ARE ONE RULE ──────────────────────────────────────
 * Lifted out of the two files by source, so this cannot pass by testing a
 * third copy written here that agrees with neither. */
function lift(file, label) {
  const src = readFileSync(file, 'utf8');
  const i = src.indexOf('function parseDealVideos');
  if (i < 0) return { err: `parseDealVideos not found in ${label}` };
  /* Brace-match the body rather than regex it — the function contains braces. */
  const open = src.indexOf('{', i);
  let depth = 0, end = -1;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) { end = k + 1; break; } }
  }
  if (end < 0) return { err: `could not read the body of parseDealVideos in ${label}` };
  let body = src.slice(open, end);
  /* The Deno copy is typed; strip the annotations so the body is plain JS. */
  body = body.replace(/:\s*(?:unknown|string|number)\b/g, '');
  try {
    // eslint-disable-next-line no-new-func
    return { fn: new Function('deal', `${body.slice(1, -1)}`) };
  } catch (e) {
    return { err: `${label}: ${e.message}` };
  }
}

const browser = lift('src/vendor/wurxbase/WurxUI.jsx', 'WurxUI.jsx');
const edge = lift('supabase/functions/reacher-sync/index.ts', 'reacher-sync');
check(!browser.err, 'the browser copy of parseDealVideos was found and is runnable', browser.err);
check(!edge.err, 'the Edge Function copy of parseDealVideos was found and is runnable', edge.err);

const creators = await all('creators?select=id,brand,name,deal,videos,payment_status,video_codes');
check(creators.length > 0, 'there are creators to check at all', `${creators.length} rows`);

if (browser.fn && edge.fn && creators.length) {
  /* Every deal string that exists, plus the shapes the parser claims to read,
     so a rule nobody happens to use today is still covered. */
  const cases = [...new Set(creators.map((c) => String(c.deal ?? '')))];
  const synthetic = [
    '$200 / 5 videos', '$200/5', '$200 - 3', '$200 x 4', '$200 for 6', '5 vids',
    '10 clips', '2 posts', '7v', '8 V', '', 'flat fee', '$1,000 / 12 videos',
    '$99.50 x 2', 'no numbers here', '0 videos',
  ];
  let same = 0;
  const diffs = [];
  for (const d of [...cases, ...synthetic]) {
    const a = browser.fn(d), b = edge.fn(d);
    if (a === b) same++; else diffs.push(`"${d}" → browser ${a}, edge ${b}`);
  }
  check(diffs.length === 0,
    'the browser and the Edge Function read every real deal string identically',
    diffs.length ? diffs.slice(0, 4).join(' | ') : `${same} strings, ${cases.length} of them real`);
  /* A guard on the guard: if the parser stopped finding numbers entirely, both
     copies would agree on 0 for everything and the check above would be green
     while the rule was dead. */
  const parsed = cases.filter((d) => browser.fn(d) > 0).length;
  check(parsed > 0,
    'and it actually finds a video count in real deals, rather than agreeing on nothing',
    `${parsed} of ${cases.length} distinct deal strings carry one`);
}

/* ── 2. NOBODY IS STUCK ───────────────────────────────────────────────────
 * The bug, stated as data: delivered everything the deal asked for, not paid,
 * and still not flagged Done — so the screen files them under Videos in
 * Progress and nobody is asked to pay them. */
let stuckNames = [];
if (browser.fn) {
  const stuck = [];
  let complete = 0, notDone = 0;
  for (const c of creators) {
    if (c.videos !== 'Done') notDone++;
    const committed = browser.fn(c.deal);
    if (committed <= 0) continue;
    const delivered = (Array.isArray(c.video_codes) ? c.video_codes : [])
      .filter((v) => String(v?.video || '').trim()).length;
    if (delivered >= committed) {
      complete++;
      if (c.payment_status !== 'Paid' && c.videos !== 'Done') {
        stuck.push(`${c.brand}/${c.name} ${delivered}/${committed}`);
      }
    }
  }
  stuckNames = stuck;
  /* TWO GUARDS, because "nobody is stuck" is true of an empty table and true
     again of a table where every single row happens to be flagged Done. Both
     would be green and neither would mean anything. */
  check(complete > 0, 'there are completed deals to judge', `${complete} rows have delivered in full`);
  check(notDone > 0, 'and the flag is not simply set on everything',
    `${notDone} of ${creators.length} rows are not flagged Done`);
  check(stuck.length === 0,
    'NO creator has delivered their whole deal and been left out of Payment Pending',
    stuck.length ? stuck.slice(0, 6).join(' | ') : `${complete} complete deals, all accounted for`);

  /* NOT CHECKED, AND DELIBERATELY: "nothing is flagged Done without having
     delivered". 444 rows on dev are exactly that and none of them is a bug — a
     deal gets renegotiated, a link never gets pasted in, a creator is released
     early. Staff own that direction of the flag. The only rule this file
     guards is that the machine never LEAVES somebody out. */
}

/* ── 3. THE RULE ONLY EVER MOVES FORWARD ──────────────────────────────────
 * The sync must never write a status backwards. A row that is Paid is further
 * along than one that is owed, and a sync that walks that back would un-pay
 * somebody on a screen Asad reads to decide who gets money. Asserted on the
 * source, because the failure would be a line of code that should not exist. */
const syncSrc = readFileSync('supabase/functions/reacher-sync/index.ts', 'utf8');
const flatSync = syncSrc.replace(/\s+/g, ' ');
check(flatSync.includes("if (row.payment_status === 'Paid') continue;"),
  'the sync skips rows that are already Paid');
check(!/videos:\s*'In Progress'/.test(syncSrc),
  'the sync never writes a status backwards to In Progress');
check(!/payment_status:\s*'/.test(syncSrc),
  'and it does not overwrite payment_status, which a human owns');

/* THE BEHAVIOURAL HALF. Everything above reads the database, which shows the
 * RESULT of a sync that has already run — a state a human could equally have
 * typed by hand. This asks the function itself what it WOULD do, and checks
 * that every row it proposes to flag has really earned it. It writes nothing.
 *
 * Without staff credentials it FAILS rather than skipping: a section that
 * quietly does not run is the exact shape of lie this project keeps catching.
 * The service role cannot call this function by design, so it signs in. */
const EMAIL = process.env.COLLAB_STAFF_EMAIL || 'asad@wurxmedia.com';
const PASSWORD = process.env.COLLAB_STAFF_PASSWORD || '';
if (!PASSWORD) {
  check(false, 'COLLAB_STAFF_PASSWORD is set, so the sync could be asked what it would do',
    'unset — the behavioural half of this file did not run');
} else {
  const envTxt = readFileSync('.env.local', 'utf8');
  const ANON = (envTxt.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.*)$/m) || [])[1]?.trim() || '';
  const si = await fetch(`${URL_}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const auth = await si.json().catch(() => ({}));
  check(!!auth.access_token, 'signed in as staff to ask the sync',
    auth.access_token ? EMAIL : JSON.stringify(auth).slice(0, 90));
  if (auth.access_token) {
    const r = await fetch(`${URL_}/functions/v1/reacher-sync`, {
      method: 'POST',
      headers: { apikey: ANON, Authorization: `Bearer ${auth.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    });
    const out = await r.json().catch(() => ({}));
    check(r.ok && !!out.shop, 'the sync answered a dry run', r.ok ? String(out.shop) : `HTTP ${r.status}`);
    check(out.dryRun === true, 'and it was a DRY run, so nothing was written', String(out.dryRun));
    check(Array.isArray(out.markedDone), 'it reports which rows it would move to Payment Pending');

    if (r.ok && Array.isArray(out.markedDone) && browser.fn) {
      const irwin = new Map(creators.filter((c) => c.brand === 'Irwin Naturals')
        .map((c) => [String(c.name ?? ''), c]));
      check(irwin.size > 0, 'and there are Irwin rows to judge it against', `${irwin.size} rows`);
      const unearned = [];
      for (const entry of out.markedDone) {
        const name = String(entry).replace(/\s+\d+\/\d+$/, '');
        const c = irwin.get(name);
        if (!c) { unearned.push(`${entry} — no such Irwin row`); continue; }
        const committed = browser.fn(c.deal);
        const delivered = (Array.isArray(c.video_codes) ? c.video_codes : [])
          .filter((v) => String(v?.video || '').trim()).length;
        if (!(committed > 0 && delivered >= committed)) unearned.push(`${entry} is really ${delivered}/${committed}`);
        if (c.payment_status === 'Paid') unearned.push(`${entry} is already Paid and must be left alone`);
      }
      check(unearned.length === 0,
        'every row it would flag has genuinely delivered its whole deal',
        unearned.length ? unearned.slice(0, 4).join(' | ') : `${out.markedDone.length} proposed`);
      check(stuckNames.length === 0 || out.markedDone.length > 0,
        'and anything the data half found stuck is something the sync would fix',
        `${stuckNames.length} stuck, ${out.markedDone.length} proposed`);
      /* SAID OUT LOUD, because a green line above an empty list is the thing
         this project keeps being caught by: with nothing to propose, the two
         checks above are true of a function that proposes nothing ever. They
         are regression cover, not proof. The proof was the run on 2026-09-29
         that proposed exactly "Danny 5/5" and nothing else, against a database
         where Danny was the only row in that state — and the data half above
         is what actually fails if the flip ever stops happening. */
      if (!out.markedDone.length) {
        console.log('  NOTE  nothing is stuck right now, so the two checks above had'
          + ' nothing to judge. The data half is what guards this.');
      }
    }
  }
}

/* ── 4. THE FLAG IS WHAT THE SCREEN ACTUALLY READS ────────────────────────
 * If `statusOf` ever stopped deriving Payment Pending from `videos === 'Done'`,
 * everything above would still pass and the screen would still be wrong. */
const uiSrc = readFileSync('src/vendor/wurxbase/WurxUI.jsx', 'utf8');
check(/if \(c\?\.videos === 'Done'\)\s*return 'pending';/.test(uiSrc),
  "the screen still derives Payment Pending from videos === 'Done'");
check(/if \(c\?\.payment_status === 'Paid'\) return 'sent';/.test(uiSrc),
  'and still treats Paid as further along than pending');

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
