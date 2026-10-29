#!/usr/bin/env node
/**
 * THE CLIENT SHARE LINK, ATTACKED.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/collabs/check-collab-share.mjs
 *
 * A link that needs no login is a password in a URL bar. This suite is the
 * evidence that it behaves like one: that the tables holding it are unreachable,
 * that only an owner can mint one, that a link opens exactly the brands it was
 * given and nothing else, that expiry and revocation are real, and — the part
 * that matters most — that the things a client must never see are ABSENT FROM
 * THE BYTES, not merely missing from the screen.
 *
 * THE PII TEST USES REAL VALUES. It reads a shared creator's actual phone
 * number and email with the service key, then asserts those exact strings do
 * not occur anywhere in the payload. A test for the KEY `email` would pass
 * while the address sat inside some other field.
 *
 * NOTHING REAL IS TOUCHED. It mints its own links against an existing brand,
 * reads, and deletes them in a `finally`. It writes nothing to Paid Collabs.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assertDevProject } from '../../lib/dev-guard.mjs';
const require = createRequire(process.cwd() + '/package.json');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = assertDevProject(env.VITE_SUPABASE_URL);
const ANON = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.VITE_SUPABASE_ANON_KEY;
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');

const BRAND = process.env.BRAND || 'Apothecary';
const OTHER = process.env.OTHER_BRAND || 'Penetrex';

const svc = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const wb = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, db: { schema: 'wurxbase' } });
const anon = () => createClient(URL_, ANON, { auth: { persistSession: false } });

const pass = [], fail = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);
const share = (body, init = {}) => fetch(`${URL_}/functions/v1/collab-share`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...init,
});

const made = [];
let creature = null; /* a throwaway signed-in user who is not an owner */

try {
  /* ── 1 · the tables are not reachable by anybody through the API ─────── */
  for (const table of ['collab_share_links', 'collab_share_views']) {
    const { data, error } = await anon().from(table).select('*').limit(1);
    check(Boolean(error) || (data ?? []).length === 0, `signed out: ${table} is unreadable`, error ? error.code : `${(data ?? []).length} rows came back`);
    const { error: insErr } = await anon().from(table).insert({ label: 'x' });
    check(Boolean(insErr), `signed out: ${table} cannot be written`, insErr ? insErr.code : 'INSERT WAS ACCEPTED');
  }

  /* ── 2 · only an owner can mint ──────────────────────────────────────── */
  const { error: anonMint } = await anon().rpc('collab_share_create', { p_label: 'x', p_brands: [BRAND] });
  check(Boolean(anonMint), 'signed out: cannot mint a link', anonMint ? anonMint.code : 'A LINK WAS MINTED');

  const email = `share-probe-${Date.now()}@example.com`;
  const password = `Pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;
  const { data: created, error: cErr } = await svc.auth.admin.createUser({ email, password, email_confirm: true });
  if (cErr) throw cErr;
  creature = created.user;
  await svc.from('profiles').update({ role: 'creator' }).eq('id', creature.id);
  const asCreator = anon();
  const { error: siErr } = await asCreator.auth.signInWithPassword({ email, password });
  check(!siErr, 'the throwaway creator can sign in (so the next checks mean something)', siErr?.message);
  const { error: creatorMint } = await asCreator.rpc('collab_share_create', { p_label: 'x', p_brands: [BRAND] });
  check(Boolean(creatorMint), 'a creator cannot mint a link', creatorMint ? creatorMint.code : 'A LINK WAS MINTED');
  const { data: creatorList } = await asCreator.rpc('collab_share_list');
  check((creatorList ?? []).length === 0, 'a creator sees no links', `${(creatorList ?? []).length} rows`);

  /* ── 3 · an owner mints one, and it opens ────────────────────────────── */
  const { data: mint, error: mErr } = await svc.rpc('collab_share_create', {
    p_label: `probe ${BRAND}`, p_brands: [BRAND], p_days: 2,
  });
  if (mErr) throw mErr;
  const link = Array.isArray(mint) ? mint[0] : mint;
  made.push(link.id);
  check(/^[A-Za-z0-9_-]{32}$/.test(link.token || ''), 'the link is 32 url-safe characters', link.token ? `${link.token.length} chars` : 'NO TOKEN');

  const { data: stored } = await svc.from('collab_share_links').select('token_hash, token_hint').eq('id', link.id).single();
  check(stored?.token_hash && !stored.token_hash.includes(link.token), 'the database stores a fingerprint, not the link', stored?.token_hash?.slice(0, 12) + '…');

  const res = await share({ token: link.token });
  const body = await res.text();
  const payload = JSON.parse(body);
  check(res.status === 200, 'the link opens with no login, no key, no session', `${res.status}`);
  check(Array.isArray(payload.data) && payload.data.length === 1 && payload.data[0].brand === BRAND,
    `it carries exactly one brand: ${BRAND}`, JSON.stringify(payload.data?.map((d) => d.brand)));
  check(payload.data?.[0]?.creators?.length > 0, 'and real rows came back', `${payload.data?.[0]?.creators?.length ?? 0} creators`);

  /* ── 4 · the other brand is nowhere in the bytes ─────────────────────── */
  check(!body.includes(OTHER), `no trace of ${OTHER} in the payload`, body.includes(OTHER) ? 'FOUND IT' : '');

  /* ── 5 · what a client must never see is not in the bytes ────────────── */
  const { data: people } = await wb.from('creators')
    .select('name, whatsapp_number, email, paypal, zelle, comments, airtable_id, payment_status, ad_spent')
    .eq('brand', BRAND).limit(400);
  const secrets = [];
  for (const p of people ?? []) {
    for (const [k, v] of Object.entries(p)) {
      if (k === 'name' || v === null || v === undefined) continue;
      const s = String(v).trim();
      /* Only values distinctive enough that finding them would be real. */
      if (s.length >= 6 && !['Paid', 'Unpaid', 'Pending', 'Payment Pending'].includes(s)) secrets.push({ k, s });
    }
  }
  const leaked = secrets.filter((x) => body.includes(x.s));
  check(secrets.length > 0, 'the brand really holds personal and payment data, so this test can fail', `${secrets.length} values checked`);
  check(leaked.length === 0, 'not one phone number, email, payment detail, comment or payment status is in the payload',
    leaked.slice(0, 3).map((x) => x.k).join(', '));

  const keys = new Set();
  (function walk(v) {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
  })(payload);
  /* allocated, paid and costPerVideo ARE shared: they are three of the five
     cards the staff screen shows, and the boss asked for the same view
     (DECISIONS, 2026-09-17). Ad spend, ROI, payment status, contact details and
     row ids are the ones that may never appear. */
  const banned = [...keys].filter((k) => /^(adSpend|ad_spent|roi|deals|payment_status|status|email|whatsapp_number|paypal|zelle|comments|airtable_id|id)$/i.test(k));
  check(banned.length === 0, 'no forbidden field name anywhere in the payload', banned.join(', '));

  /* ── 6 · ad spend and ROI, the two he named ──────────────────────────── */
  const { data: adRows } = await svc.from('euka_ad_video_month').select('item_id, cost').limit(5000);
  const shared = new Set((payload.data?.[0]?.creators ?? []).flatMap((c) => (c.videos ?? []).map((v) => (String(v.url).match(/video\/(\d+)/) || [])[1])).filter(Boolean));
  const overlapping = (adRows ?? []).filter((r) => shared.has(r.item_id));
  check(overlapping.length > 0, 'the shared videos really do have ad spend in our database, so this test can fail', `${overlapping.length} of them`);
  const costLeak = overlapping.filter((r) => Number(r.cost) > 0 && body.includes(String(Number(r.cost).toFixed(2))));
  check(costLeak.length === 0, 'no video\'s ad spend figure appears in the payload', costLeak.slice(0, 3).map((r) => r.cost).join(', '));

  /* ── 7 · a link that should not open ─────────────────────────────────── */
  const tampered = link.token.slice(0, -1) + (link.token.endsWith('a') ? 'b' : 'a');
  const r1 = await share({ token: tampered });
  const t1 = await r1.text();
  check(r1.status === 404, 'a link with one character changed is refused', `${r1.status}`);
  check(!t1.includes('creators') && t1.length < 200, 'and leaks nothing about what exists', t1.slice(0, 80));

  const r2 = await share({ token: 'x'.repeat(32) });
  check(r2.status === 404 && (await r2.text()) === t1, 'an invented link is refused with the SAME answer', `${r2.status}`);

  const r3 = await share({ token: 'short' });
  check(r3.status === 400, 'a malformed link is a plain bad request', `${r3.status}`);

  /* revoked */
  const { data: mint2 } = await svc.rpc('collab_share_create', { p_label: 'probe revoke', p_brands: [BRAND], p_days: 2 });
  const link2 = Array.isArray(mint2) ? mint2[0] : mint2;
  made.push(link2.id);
  check((await share({ token: link2.token })).status === 200, 'a second link opens before it is revoked');
  await svc.rpc('collab_share_revoke', { p_id: link2.id });
  check((await share({ token: link2.token })).status === 404, 'and is dead the moment it is revoked');

  /* expired: set the date into the past with the service key */
  const { data: mint3 } = await svc.rpc('collab_share_create', { p_label: 'probe expiry', p_brands: [BRAND], p_days: 2 });
  const link3 = Array.isArray(mint3) ? mint3[0] : mint3;
  made.push(link3.id);
  /* BOTH dates move. `expires_at > created_at` is a constraint, so pushing the
     expiry alone into the past is refused — and the first version of this check
     ignored that error and "tested" a link that had never expired. Assert the
     setup, then the behaviour. */
  const { error: ageErr } = await svc.from('collab_share_links').update({
    created_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
    expires_at: new Date(Date.now() - 86_400_000).toISOString(),
  }).eq('id', link3.id);
  const { data: aged } = await svc.from('collab_share_links').select('expires_at').eq('id', link3.id).single();
  check(!ageErr && new Date(aged.expires_at).getTime() < Date.now(), 'a link can be aged past its expiry for this test', ageErr?.message ?? aged?.expires_at);
  check((await share({ token: link3.token })).status === 404, 'an expired link is dead');

  /* ── 7b · months are a whitelist, not a default ──────────────────────── */
  /* The link is minted for ONE month that is not the newest, so "it worked"
     cannot be the page simply showing its usual latest month. */
  const older = (payload.months ?? [])[1];
  check(Boolean(older) && older !== payload.month, `${BRAND} has an older month to scope a link to`, `${(payload.months ?? []).join(', ')}`);
  if (older) {
    const { data: mintM, error: mErrM } = await svc.rpc('collab_share_create', {
      p_label: 'probe months', p_brands: [BRAND], p_days: 2, p_months: [older],
    });
    if (mErrM) throw mErrM;
    const linkM = Array.isArray(mintM) ? mintM[0] : mintM;
    made.push(linkM.id);

    const rM = await share({ token: linkM.token });
    const bM = await rM.text();
    const pM = JSON.parse(bM);
    check(JSON.stringify(pM.months) === JSON.stringify([older]), `a month-scoped link offers only ${older}`, JSON.stringify(pM.months));
    check(pM.month === older, 'and opens on it', pM.month);
    const outside = (pM.data?.[0]?.creators ?? []).filter((c) => String(c.onboarded ?? '').slice(0, 7) !== older);
    check((pM.data?.[0]?.creators ?? []).length > 0 && outside.length === 0,
      'every row it carries belongs to that month', `${outside.length} rows from another month`);

    /* asking for a month it was not given */
    const rAsk = await share({ token: linkM.token, month: payload.month });
    const pAsk = await rAsk.json();
    check(pAsk.month === older, 'asking for a month outside the link is answered with one inside it', pAsk.month);
    const askOutside = (pAsk.data?.[0]?.creators ?? []).filter((c) => String(c.onboarded ?? '').slice(0, 7) !== older);
    check(askOutside.length === 0, 'and carries no row from the month it was not given', `${askOutside.length} rows`);

    /* "all time" on a scoped link means all of ITS months */
    const rAll = await share({ token: linkM.token, month: 'all' });
    const pAll = await rAll.json();
    const allOutside = (pAll.data?.[0]?.creators ?? []).filter((c) => String(c.onboarded ?? '').slice(0, 7) !== older);
    check(allOutside.length === 0, 'and All time on it means all of ITS months, not all months', `${allOutside.length} rows from elsewhere`);
  }

  /* ── 8 · sections off means absent, not hidden ───────────────────────── */
  const { data: mint4 } = await svc.rpc('collab_share_create', {
    p_label: 'probe sections', p_brands: [BRAND], p_days: 2,
    p_show_kpis: false, p_show_top_videos: false, p_show_creators: true, p_show_videos: false,
  });
  const link4 = Array.isArray(mint4) ? mint4[0] : mint4;
  made.push(link4.id);
  const r4 = await share({ token: link4.token });
  const b4 = await r4.text();
  const p4 = JSON.parse(b4);
  check(p4.data?.[0] && !('kpis' in p4.data[0]) && !('topVideos' in p4.data[0]),
    'switched-off sections are absent from the payload, not hidden', Object.keys(p4.data?.[0] ?? {}).join(', '));
  check(!b4.includes('"videos":['), 'with videos off, not one video link is sent', 'video array found');
  check(!b4.includes('"spark"'), 'and no spark code');

  /* ── 9 · the view is recorded, the address is not ────────────────────── */
  const { data: views } = await svc.from('collab_share_views').select('ip_hash, user_agent').eq('link_id', link.id);
  check((views ?? []).length >= 1, 'every open is recorded', `${(views ?? []).length} views`);
  check((views ?? []).every((v) => !v.ip_hash || /^[0-9a-f]{64}$/.test(v.ip_hash)), 'the visitor address is stored only as a hash');
  const { data: after } = await svc.from('collab_share_links').select('view_count, last_viewed_at').eq('id', link.id).single();
  check((after?.view_count ?? 0) >= 1 && Boolean(after?.last_viewed_at), 'and the link says when it was last opened', `${after?.view_count} views`);

  /* ── 10 · a client cannot write, through the door or around it ────────── */
  const get = await fetch(`${URL_}/functions/v1/collab-share`, { method: 'GET' });
  check(get.status === 405 || get.status === 404, 'the door answers nothing but POST', `${get.status}`);
  const { error: wErr } = await anon().schema('wurxbase').from('creators').update({ name: 'nope' }).eq('brand', BRAND);
  check(Boolean(wErr), 'signed out: Paid Collabs itself is still unwritable', wErr ? wErr.code : 'UPDATE WAS ACCEPTED');
  const { data: wRead, error: rErr } = await anon().schema('wurxbase').from('creators').select('name').limit(1);
  check(Boolean(rErr) || (wRead ?? []).length === 0, 'signed out: and unreadable', rErr ? rErr.code : `${(wRead ?? []).length} rows`);
} finally {
  for (const id of made) await svc.from('collab_share_links').delete().eq('id', id);
  if (creature) await svc.auth.admin.deleteUser(creature.id).catch(() => {});
}

console.log('');
for (const p of pass) console.log('  PASS  ' + p);
for (const f of fail) console.log('  FAIL  ' + f);
console.log(`\n${pass.length} passed, ${fail.length} failed.`);
process.exit(fail.length ? 1 : 0);
