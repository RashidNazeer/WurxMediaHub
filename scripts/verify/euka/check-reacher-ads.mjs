#!/usr/bin/env node
/**
 * IS THE AD SIDE OF REACHER ACTUALLY READABLE?
 *
 *   node scripts/verify/euka/check-reacher-ads.mjs
 *
 * Rashid, 2026-09-24: "check that ad account for Irwin Naturals is connected
 * now, I need to show ad spend and roi and other relevant details like we are
 * seeing others".
 *
 * TWO DIFFERENT QUESTIONS, AND THEY MUST NOT BE ANSWERED TOGETHER:
 *
 *   1. Is Irwin's ad account connected?  — a fact about Rashid's TikTok setup,
 *      which we can only report, not fix.
 *   2. Does our ad pipe work?            — a fact about our code, which we can.
 *
 * Asking only Irwin answers neither, because an empty answer from an
 * unconnected shop looks exactly like an empty answer from a broken call. So
 * every shop the key can see is asked, and the pipe is exercised against a shop
 * that HAS campaigns.
 *
 * The bug this exists to keep dead: `/gmv-max/videos/summary` refuses a range
 * longer than 90 days, and the sync asks for 120. It never failed only because
 * the call sits behind `if (campaigns > 0)` and Irwin has none — so the day the
 * ad account is connected would have been the day the sync broke. This checks
 * BOTH that the limit is still real and that our chunked window clears it.
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')]),
);
const KEY = env.REACHER_API;
const BASE = 'https://api.reacherapp.com/public/v1';

const pass = [], fail = [], notes = [];
const check = (ok, m, d) => (ok ? pass : fail).push(d ? `${m} — ${d}` : m);

const H = (shop) => ({
  'x-api-key': KEY, 'x-shop-id': String(shop),
  'content-type': 'application/json', accept: 'application/json',
});
const iso = (d) => d.toISOString().slice(0, 10);
const get = async (path, shop) => {
  const r = await fetch(BASE + path, { headers: H(shop), signal: AbortSignal.timeout(45_000) });
  return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : await r.text() };
};
const post = async (path, shop, body) => {
  const r = await fetch(BASE + path, {
    method: 'POST', headers: H(shop), body: JSON.stringify(body), signal: AbortSignal.timeout(45_000),
  });
  return { ok: r.ok, status: r.status, body: r.ok ? await r.json() : await r.text() };
};

/* The same chunking `_shared/reacher.ts` does, so this proves the algorithm and
   not merely that some short window happens to work. */
const SPEND_MAX_DAYS = 90;
const spans = (from, to) => {
  const start = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`);
  const step = (SPEND_MAX_DAYS - 1) * 86_400_000, out = [];
  for (let a = start; a <= end; a += step + 86_400_000) {
    out.push({ a: iso(new Date(a)), b: iso(new Date(Math.min(a + step, end))) });
  }
  return out;
};

const to = iso(new Date());
const from120 = iso(new Date(Date.now() - 120 * 86_400_000));

const shopsRes = await get('/shops', 'all');
check(shopsRes.ok, 'Reacher answers about our shops', `HTTP ${shopsRes.status}`);
const shops = shopsRes.body?.data ?? [];
/* THE GUARD. Everything below is meaningless against an empty shop list. */
check(shops.length > 0, 'the key sees at least one shop', `${shops.length}`);
if (!shops.length) { report(); }

let withCampaigns = null, irwin = null;
for (const s of shops) {
  const c = await get('/gmv-max/campaigns', s.shop_id);
  const n = c.ok ? (c.body?.pagination?.total_count ?? (c.body?.data?.length ?? 0)) : -1;
  check(c.ok, `${s.shop_name}: the campaigns endpoint answers`, `HTTP ${c.status}`);
  notes.push(`${String(s.shop_name).padEnd(18)} ${n < 0 ? 'ERROR' : `${n} GMV Max campaign${n === 1 ? '' : 's'}`}`);
  if (s.shop_name === 'Irwin Naturals') irwin = { shop: s, campaigns: n };
  if (n > 0 && !withCampaigns) withCampaigns = { shop: s, campaigns: n };
}

/* ── the limit is real, and our window clears it ───────────────────────── */
check(!!withCampaigns, 'at least one shop has campaigns, so the ad pipe can be exercised at all',
  withCampaigns ? `${withCampaigns.shop.shop_name}, ${withCampaigns.campaigns}` : 'none do — this check cannot prove anything today');

if (withCampaigns) {
  const id = withCampaigns.shop.shop_id;
  const naive = await post('/gmv-max/videos/summary', id, {
    page: 1, page_size: 100, start_date: from120, end_date: to,
  });
  check(!naive.ok && /90 days/i.test(String(naive.body)),
    'the 90-day limit is still real (a 120-day ask is refused)',
    `HTTP ${naive.status} ${String(naive.body).slice(0, 80)}`);

  const parts = spans(from120, to);
  check(parts.length > 1, 'a 120-day window is split into more than one chunk', `${parts.length} chunks`);
  check(parts.every((p) => (Date.parse(p.b) - Date.parse(p.a)) / 86_400_000 <= SPEND_MAX_DAYS - 1,
  ), 'every chunk is inside their limit', parts.map((p) => `${p.a}→${p.b}`).join(' '));

  let rows = 0, spend = 0, revenue = 0, allOk = true;
  for (const p of parts) {
    const r = await post('/gmv-max/videos/summary', id, {
      page: 1, page_size: 100, start_date: p.a, end_date: p.b,
    });
    if (!r.ok) { allOk = false; check(false, `chunk ${p.a}→${p.b} was accepted`, `HTTP ${r.status} ${String(r.body).slice(0, 80)}`); continue; }
    const data = r.body?.data ?? [];
    rows += data.length;
    for (const d of data) {
      spend += Number(d.spend ?? d.cost ?? 0);
      revenue += Number(d.gross_revenue ?? d.revenue ?? 0);
    }
  }
  check(allOk, 'every chunk of the split window was accepted');
  check(rows > 0, `${withCampaigns.shop.shop_name}: real ad figures come back`, `${rows} rows, $${spend.toFixed(2)} spend, $${revenue.toFixed(2)} ad revenue`);
  if (rows > 0) {
    notes.push(`pipe proven on ${withCampaigns.shop.shop_name}: $${spend.toFixed(2)} spend and $${revenue.toFixed(2)} ad revenue over ${parts.length} chunks (ROI ${(revenue / (spend || 1)).toFixed(2)}x)`);
  }
}

/* ── and the answer to the actual question ─────────────────────────────── */
if (irwin) {
  notes.push(irwin.campaigns > 0
    ? `IRWIN IS CONNECTED: ${irwin.campaigns} GMV Max campaign(s). Run the sync and the spend will land.`
    : 'IRWIN IS NOT CONNECTED: Reacher reports 0 GMV Max campaigns for that shop, so there is no ad spend to read.');
  check(true, 'Irwin\'s connection state was read', irwin.campaigns > 0 ? `${irwin.campaigns} campaigns` : '0 campaigns');
} else {
  check(false, 'Irwin Naturals is among the shops this key sees');
}

function report() {
  console.log('');
  for (const n of notes) console.log('  · ' + n);
  console.log('');
  for (const p of pass) console.log('  PASS  ' + p);
  for (const f of fail) console.log('  FAIL  ' + f);
  console.log(`\n${pass.length} passed, ${fail.length} failed.`);
  process.exit(fail.length ? 1 : 0);
}
report();
