#!/usr/bin/env node
/**
 * Can a brand's creative brief be added and changed from the screen, safely?
 *
 * Runs the REAL `collab-angles` handler in Node with an in-memory database
 * (scripts/lib/mock-supabase.mjs) and a stand-in for Google, so no credentials,
 * network or Deno are needed. Three parts:
 *
 *   1. THE LINK PARSER, both copies (browser and Edge Function), over one table
 *      of inputs. They must agree exactly, because one decides what the screen
 *      says and the other what is stored.
 *   2. THE FUNCTION, end to end: add a first brief, add a second, refuse a
 *      duplicate product, change a link, refuse a private document, a missing
 *      one and an empty one, keep going when Google cannot be asked, and refuse
 *      anybody who is not staff.
 *   3. THE SCREEN is wired to the same actions and cannot start a brand that has
 *      no brief.
 *
 * Run: pnpm verify:angles-briefs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBriefUrl as serverParse } from '../../../supabase/functions/_shared/brief-url.ts';
import { parseBriefUrl as clientParse } from '../../../src/lib/brief-url.ts';

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

/* ── 1. the parser, both copies ───────────────────────────────────────────── */
console.log('\n1. THE LINK PARSER (browser copy and Edge Function copy)');
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const CANON = `https://docs.google.com/document/d/${ID}/edit`;
const cases = [
  ['a normal edit link', `https://docs.google.com/document/d/${ID}/edit`, { url: CANON }],
  ['extra query parameters and a fragment are dropped',
    `https://docs.google.com/document/d/${ID}/edit?usp=sharing&foo=1#heading=h.abc`, { url: CANON }],
  ['the tab is kept (a document with a tab per product)',
    `https://docs.google.com/document/d/${ID}/edit?tab=t.fuxgybmnbiz4&usp=sharing`,
    { url: `${CANON}?tab=t.fuxgybmnbiz4`, tab: 't.fuxgybmnbiz4' }],
  ['a malformed tab is ignored', `https://docs.google.com/document/d/${ID}/edit?tab=drop;table`, { url: CANON }],
  ['a /u/0/ account path', `https://docs.google.com/document/u/0/d/${ID}/edit`, { url: CANON }],
  ['no https:// typed', `docs.google.com/document/d/${ID}/edit`, { url: CANON }],
  ['a /view link', `https://docs.google.com/document/d/${ID}/view`, { url: CANON }],
  ['surrounding spaces', `   https://docs.google.com/document/d/${ID}/edit   `, { url: CANON }],
  ['a Drive link is refused with a hint', `https://drive.google.com/file/d/${ID}/view`, { ok: false, mentions: 'Drive' }],
  ['a published-to-the-web link is refused', `https://docs.google.com/document/d/e/2PACX-${ID}/pub`, { ok: false, mentions: 'published' }],
  ['a Google Sheet is refused', `https://docs.google.com/spreadsheets/d/${ID}/edit`, { ok: false, mentions: 'document' }],
  ['another website is refused', `https://example.com/document/d/${ID}/edit`, { ok: false, mentions: 'Google Docs' }],
  ['plain http is refused', `http://docs.google.com/document/d/${ID}/edit`, { ok: false, mentions: 'https' }],
  ['a too-short document id is refused', 'https://docs.google.com/document/d/short/edit', { ok: false }],
  ['an empty box', '', { ok: false, mentions: 'Paste' }],
  ['not a link at all', 'the brief is in the drive', { ok: false }],
];
for (const [label, input, want] of cases) {
  const s = serverParse(input);
  const c = clientParse(input);
  check(`${label}: both copies agree`, JSON.stringify(s) === JSON.stringify(c), `${JSON.stringify(s)} vs ${JSON.stringify(c)}`);
  if (want.ok === false) {
    check(`${label}: refused${want.mentions ? ` (says "${want.mentions}")` : ''}`,
      s.ok === false && (!want.mentions || s.error.includes(want.mentions)), JSON.stringify(s));
  } else {
    check(`${label}: becomes ${want.url.slice(-30)}`, s.ok && s.url === want.url && (want.tab === undefined || s.tab === want.tab),
      JSON.stringify(s));
  }
}

/* ── 2. the function, end to end ──────────────────────────────────────────── */
console.log('\n2. THE EDGE FUNCTION, end to end');

let googleMode = 'public';
let googleCalls = 0;
const LONG_TEXT = 'A real creative brief. '.repeat(10);
globalThis.fetch = async (url) => {
  googleCalls += 1;
  if (!String(url).startsWith('https://docs.google.com/document/d/')) throw new Error(`unexpected fetch ${url}`);
  switch (googleMode) {
    case 'public': return new Response(LONG_TEXT, { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    /* A private document: fetch follows Google's redirect and ENDS at the sign-in
       page, which is HTML. A response's url cannot be set by the constructor. */
    case 'private': {
      const res = new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
      Object.defineProperty(res, 'url', { value: 'https://accounts.google.com/ServiceLogin?continue=x' });
      return res;
    }
    case 'html': return new Response('<html>Sign in</html>', { status: 200, headers: { 'content-type': 'text/html' } });
    case 'forbidden': return new Response('no', { status: 403 });
    case 'notfound': return new Response('no', { status: 404 });
    case 'empty': return new Response('x', { status: 200, headers: { 'content-type': 'text/plain' } });
    case 'down': throw new TypeError('network down');
    default: throw new Error('bad mode');
  }
};

const ENV = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'service' };
let handler = null;
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handler = h; } };
console.error = () => {};
const mock = await import('../../lib/mock-supabase.mjs');
await import('../../../supabase/functions/collab-angles/index.ts');
if (!handler) throw new Error('collab-angles did not register a handler');
const { tables } = mock;

const doc = (n) => `https://docs.google.com/document/d/${String(n).repeat(20).slice(0, 24)}/edit`;
mock.reset({
  users: { staff: { id: 'u-staff' }, creator: { id: 'u-creator' } },
  tables: {
    profiles: [
      { id: 'u-staff', email: 'ops@x.test', role: 'ops', is_active: true },
      { id: 'u-creator', email: 'c@x.test', role: 'creator', is_active: true },
    ],
    collab_brand_briefs: [
      { id: 'b-bio', brand: 'Biostime', aliases: ['Biostime Shop US'], product: '', position: 0, brief_url: doc('B'), angles: ['A', 'B'], is_active: true },
      { id: 'b-old', brand: 'Mineral Ice', aliases: [], product: 'Retired', position: 0, brief_url: doc('R'), angles: [], is_active: false },
    ],
  },
});
const rows = () => tables.collab_brand_briefs ?? [];
const forBrand = (b) => rows().filter((r) => r.brand === b && r.is_active);

async function call(body, token = 'staff') {
  const res = await handler(new Request('https://x.supabase.co/functions/v1/collab-angles', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}
const MI = 'Mineral Ice';

let r = await call({ action: 'brief.list', brand: MI });
check('a brand with no brief lists none (a retired one does not count)', r.status === 200 && r.body.briefs.length === 0, JSON.stringify(r.body));

googleMode = 'public';
r = await call({ action: 'brief.save', brand: MI, brief_url: `${doc('M')}?usp=sharing#x` });
check('the first brief is added', r.status === 200 && r.body.created === true && r.body.verified === true, JSON.stringify(r.body));
const first = forBrand(MI)[0];
check('it is stored under the brand as typed, tidied, with no concepts yet',
  first && first.brand === MI && first.brief_url === doc('M') && first.angles.length === 0 && first.position === 0 && first.product === '',
  JSON.stringify(first));

r = await call({ action: 'brief.list', brand: MI });
check('and then the brand lists it', r.body.briefs.length === 1 && r.body.briefs[0].brief_url === doc('M') && r.body.briefs[0].angle_count === 0);

r = await call({ action: 'brief.save', brand: MI, brief_url: doc('N') });
check('a second brief WITHOUT a product name is refused, with the reason in words',
  r.status === 422 && /no product name/.test(r.body.error), JSON.stringify(r.body));

r = await call({ action: 'brief.save', brand: MI, brief_url: doc('N'), product: 'Hair Perfection' });
check('a second brief WITH a product name is added after the first',
  r.status === 200 && forBrand(MI).length === 2 && forBrand(MI)[1].position === 1 && forBrand(MI)[1].product === 'Hair Perfection',
  JSON.stringify(r.body));

r = await call({ action: 'brief.save', brand: MI, brief_url: doc('O'), product: '  hair perfection ' });
check('the same product again (any case) is refused', r.status === 422 && /already has a brief for/.test(r.body.error), JSON.stringify(r.body));

forBrand(MI)[0].angles = ['Old concept 1', 'Old concept 2'];
const oldRowId = forBrand(MI)[0].id;
r = await call({ action: 'brief.save', brand: MI, brief_url: `${doc('P')}`, id: oldRowId });
const changed = rows().find((x) => x.id === oldRowId);
check('an existing brief is UPDATED in place (not duplicated)',
  r.status === 200 && r.body.created === false && changed.brief_url === doc('P') && forBrand(MI).length === 2, JSON.stringify(r.body));
check('and its concepts are cleared, so the backend reads the new document', changed.angles.length === 0);

r = await call({ action: 'brief.save', brand: MI, brief_url: doc('Q'), id: oldRowId, product: 'Hair Perfection' });
check('renaming a brief onto another one\'s product is refused', r.status === 422, JSON.stringify(r.body));

r = await call({ action: 'brief.save', brand: MI, brief_url: doc('Q'), id: 'b-bio' });
check('a brief of ANOTHER brand cannot be changed through this brand', r.status === 400 || r.status === 422, JSON.stringify(r.body));
check('and it was not touched', rows().find((x) => x.id === 'b-bio').brief_url === doc('B'));

r = await call({ action: 'brief.save', brand: MI, brief_url: doc('Q'), id: '00000000-0000-4000-8000-000000000999' });
check('an id that does not exist is refused', r.status === 422 && /no longer exists/.test(r.body.error));

const before = forBrand('Zeta').length;
for (const [mode, expect] of [['private', /Anyone with the link/], ['html', /Anyone with the link/], ['forbidden', /Anyone with the link/], ['notfound', /could not find/], ['empty', /empty/]]) {
  googleMode = mode;
  r = await call({ action: 'brief.save', brand: 'Zeta', brief_url: doc('Z') });
  check(`a document Google answers "${mode}" for is refused, and nothing is saved`,
    r.status === 422 && expect.test(r.body.error) && forBrand('Zeta').length === before, JSON.stringify(r.body));
}

googleMode = 'down';
r = await call({ action: 'brief.save', brand: 'Zeta', brief_url: doc('Z') });
check('when Google cannot be asked at all the brief is still saved, and the answer says it was not checked',
  r.status === 200 && r.body.verified === false && forBrand('Zeta').length === 1, JSON.stringify(r.body));

googleMode = 'public';
const calls = googleCalls;
r = await call({ action: 'brief.save', brand: 'Yarrow', brief_url: 'https://drive.google.com/file/d/abc/view' });
check('a link that is not a Google Doc is refused WITHOUT asking Google', r.status === 422 && googleCalls === calls, JSON.stringify(r.body));

r = await call({ action: 'brief.list', brand: 'Biostime Shop US' });
check('a brief is found under any of the brand\'s other spellings (aliases)', r.body.briefs.length === 1 && r.body.briefs[0].id === 'b-bio');
r = await call({ action: 'brief.save', brand: 'Biostime Shop US', brief_url: doc('S') });
check('and an alias cannot be given a second brief with no product name either', r.status === 422, JSON.stringify(r.body));

r = await call({ action: 'brief.list', brand: MI }, 'creator');
check('a creator is refused', r.status === 403);
r = await call({ action: 'brief.save', brand: MI, brief_url: doc('M') }, 'creator');
check('a creator cannot save a brief either', r.status === 403 && forBrand(MI).length === 2);
r = await call({ action: 'brief.list', brand: MI }, null);
check('nobody signed in is refused', r.status === 401);

const log = (tables.audit_log ?? []).filter((x) => x.action === 'collab_angles.brief_save');
/* Four saves succeeded: two added to Mineral Ice, one of them changed, and one
   for Zeta while Google could not be asked. Every refusal wrote nothing. */
check('every saved brief is in the audit log, naming the brand and document, and refusals are not',
  log.length === 4 && log.every((x) => x.detail?.brand && x.detail?.doc), `${log.length} entries`);

/* ── 3. the screen ────────────────────────────────────────────────────────── */
console.log('\n3. THE SCREEN');
const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
const ui = read('src/routes/admin/collab-angle-briefs.tsx');
const dialog = read('src/routes/admin/collab-angle-queue.tsx');
const fn = read('supabase/functions/collab-angles/index.ts');
const sent = new Set([...ui.matchAll(/action: '(brief\.[a-z_]+)'/g)].map((m) => m[1]));
const accepted = new Set([...fn.matchAll(/z\.literal\('(brief\.[a-z_]+)'\)/g)].map((m) => m[1]));
check('the screen sends only actions the function accepts, and uses both',
  sent.size === 2 && [...sent].every((a) => accepted.has(a)) && accepted.size === 2, [...sent].join(','));
check('it checks the link before asking (the browser copy of the parser)', /parseBriefUrl\(url\)/.test(ui));
check('a brand that already has a brief must name the product for the next one', /needsProduct/.test(ui) && /needs the product/.test(ui));
check('an existing brief can be edited, and another added', /Edit link/.test(ui) && /Add another brief/.test(ui));
check('the dialog shows the briefs of the brand on screen', /<CollabAngleBriefs brand=\{brand\}/.test(dialog));
check('Categorise is blocked while the brand has no brief', /briefCount === 0/.test(dialog) && /disabled=\{startBusy \|\| busy !== null \|\| briefCount === 0\}/.test(dialog));
check('the screen never builds a Supabase client', !/getSupabase|createClient/.test(ui));
check('no hardcoded colour', !/#[0-9a-fA-F]{3,8}\b/.test(ui));
check('every type size is a rem', !/text-\[[0-9.]+px\]/.test(ui));
check('the worker reads the same table the screen writes',
  /from\('collab_brand_briefs'\)/.test(read('supabase/functions/collab-angles-sync/index.ts')));

console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);
