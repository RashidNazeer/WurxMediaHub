#!/usr/bin/env node
/**
 * LOAD CRUVA'S PER-VIDEO FIGURES INTO collab_video_metrics.
 *
 * Cruva's data endpoints need an interactive login, so the scheduled sync
 * (collab-video-hits-sync) cannot read it. The three Cruva brands (Pure Daily Care, Aqua Sonic,
 * JOYMODE) are refreshed by hand with this script, from CSV exports made through the Cruva
 * connector (search_videos with as_csv). For each shop export THREE files into one folder:
 *
 *   <prefix>30.csv    timeseries, date window = the last 30 days  (columns video_id,gmv,views)
 *   <prefix>90.csv    timeseries, date window = the last 90 days  (columns video_id,gmv,views)
 *   <prefix>Life.csv  lifetime list, no dates                      (columns video_id,gmv,views,view_count)
 *
 * prefixes: pdc (Pure Daily Care), aqua (Aqua Sonic), joy (JOYMODE). Both windows must END on the
 * same day, which is passed as --end. The rules are the sync's: a video in the lifetime file is
 * known; absent from a window = no sales in it = 0; not in the lifetime file = unverified.
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/ops/cruva-load-video-metrics.mjs --dir ./cruva --end 2026-11-09 [--dry]
 */
import fs from 'node:fs';
const arg = (n) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const DIR = (arg('--dir') ?? '').split('\\').join('/').replace(/\/?$/, '/');
const END = arg('--end');
if (!arg('--dir') || !/^\d{4}-\d{2}-\d{2}$/.test(END ?? '')) { console.error('usage: --dir <folder> --end YYYY-MM-DD [--dry]'); process.exit(2); }
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const URL = 'https://api.supabase.com/v1/projects/qinxwfdwvpkzfhcijuqw/database/query';
const DRY = process.argv.includes('--dry');
const WINDOW_END = END;
const q = async (sql) => {
  const r = await fetch(URL, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
  const t = await r.text();
  if (!r.ok) throw new Error(t.slice(0, 400));
  return JSON.parse(t);
};

/** one CSV -> Map(video_id -> {gmv, views, viewCount}) */
function readCsv(name) {
  const lines = fs.readFileSync(DIR + name + '.csv', 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const col = (n) => head.indexOf(n);
  const out = new Map();
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    const id = (c[col('video_id')] || '').trim();
    if (!/^\d+$/.test(id)) continue;
    const num = (n) => { const v = c[col(n)]; return v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null; };
    out.set(id, { gmv: num('gmv'), views: num('views'), viewCount: num('view_count') });
  }
  return out;
}

const SHOPS = [
  { brand: 'Pure Daily Care', prefix: 'pdc' },
  { brand: 'Aqua Sonic', prefix: 'aqua' },
  { brand: 'JOYMODE', prefix: 'joy' },
];

const ours = await q(`
  select btrim(c.brand) as brand, (regexp_match(e->>'video','/video/(\\d+)'))[1] as id
  from wurxbase.creators c, jsonb_array_elements(case when jsonb_typeof(c.video_codes)='array' then c.video_codes else '[]'::jsonb end) e
  where btrim(c.brand) in ('Pure Daily Care','Aqua Sonic','JOYMODE') and (regexp_match(e->>'video','/video/(\\d+)'))[1] is not null
  group by 1, 2`);

const rows = [];
const report = [];
for (const s of SHOPS) {
  const life = readCsv(s.prefix + 'Life'), w30 = readCsv(s.prefix + '30'), w90 = readCsv(s.prefix + '90');
  const mine = ours.filter((r) => r.brand === s.brand).map((r) => r.id);
  let known = 0, unknown = 0, hit30 = 0, hit90 = 0, hitViews = 0;
  for (const id of mine) {
    if (!life.has(id)) {
      rows.push({ id, known: false });
      unknown++;
      continue;
    }
    const L = life.get(id);
    const g30 = w30.has(id) ? w30.get(id).gmv : 0;   // listed in lifetime but absent from the window: no sales in it
    const g90 = w90.has(id) ? w90.get(id).gmv : 0;
    const bad = g30 === null || g90 === null;         // a listed row with no readable figure is unverified, never 0
    rows.push({ id, known: true, g30: bad ? null : g30, g90: bad ? null : g90, views: L.viewCount, life: L.gmv });
    known++;
    if (!bad && g30 >= 1000) hit30++;
    if (!bad && g90 >= 1000) hit90++;
    if ((L.viewCount ?? 0) >= 250000) hitViews++;
  }
  report.push({ brand: s.brand, ours: mine.length, known, unknown, lifetimeRows: life.size, win30Rows: w30.size, win90Rows: w90.size, g30_1k: hit30, g90_1k: hit90, views_250k: hitViews });
}
console.log(JSON.stringify(report, null, 1));
if (DRY) { console.log('dry run: nothing written, rows =', rows.length); process.exit(0); }

const n = (v) => (v === null || v === undefined ? 'null' : String(v));
let written = 0;
for (let i = 0; i < rows.length; i += 400) {
  const chunk = rows.slice(i, i + 400);
  const values = chunk.map((r) => r.known
    ? `('${r.id}', true, ${n(r.g30)}, ${n(r.g90)}, ${r.views === null || r.views === undefined ? 'null' : Math.round(r.views)}, ${n(r.life)}, '${WINDOW_END}', null, 'cruva', now())`
    : `('${r.id}', false, null, null, null, null, '${WINDOW_END}', null, 'cruva', now())`).join(',\n');
  await q(`insert into public.collab_video_metrics (item_id, known, gmv_30d, gmv_90d, views, lifetime_gmv, window_end, source_through, source, fetched_at) values\n${values}
    on conflict (item_id) do update set known = excluded.known, gmv_30d = excluded.gmv_30d, gmv_90d = excluded.gmv_90d, views = excluded.views,
      lifetime_gmv = excluded.lifetime_gmv, window_end = excluded.window_end, source = excluded.source, fetched_at = excluded.fetched_at
    where public.collab_video_metrics.source = 'cruva' or not public.collab_video_metrics.known`);
  written += chunk.length;
}
console.log('written rows:', written);
