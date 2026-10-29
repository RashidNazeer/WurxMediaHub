#!/usr/bin/env node
/**
 * Copy WurxBase's data out of their Supabase project into our `wurxbase`
 * schema. Read-only against theirs; nothing there is written or deleted.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/wurxbase/wurxbase-copy-data.mjs [--verify]
 *
 * SAFE TO RUN TWICE. Every table is emptied here before it is filled, so a
 * half-finished run leaves no duplicates and no partial merge. That truncate
 * is the only destructive act and it only ever touches OUR copy — which is why
 * the script refuses to run against production without --i-mean-prod.
 *
 * IT IS A REPLACEMENT, NOT A MERGE, AND THAT HAS A PRICE. Anything entered on
 * OUR side since the last run is discarded, including every hub_email — their
 * app_users has no such column, so the refilled rows come back null and their
 * whole team silently drops to the derived role. **Run pnpm wurxbase:link
 * immediately afterwards, then pnpm verify:wurxbase-roster.**
 *
 * IDS ARE PRESERVED. Their `activity_logs.id` is load-bearing: `saveAngles`
 * writes a row, keeps its id, and sweeps `.neq('id', keepId)`. Renumbering
 * would be invisible until the first save deleted the wrong row. The identity
 * sequences are set past the highest copied id at the end, or the next insert
 * collides with a row that already exists.
 *
 * THEIR POSTGREST CAPS EVERY RESPONSE AT 1000 ROWS and says nothing about the
 * rest, so every read here pages with Range and stops only on a short page.
 * A plain select would have copied 1000 of their 2348 log rows and looked
 * like it worked.
 */
import { readFileSync } from 'node:fs';

const THEIRS = {
  url: 'https://bnevtdezskftlrjjgbsg.supabase.co',
  key: 'sb_publishable_h7DMRqJ19S3cWaEoUR9e8Q_b5FEAEyu',
};

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const OURS = { url: env.VITE_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
if (!OURS.key) throw new Error('SUPABASE_SERVICE_KEY must be set');
if (!OURS.url) throw new Error('VITE_SUPABASE_URL missing from .env.local');

const PROD = /wurxmediahub-prod|prod/i.test(env.VITE_SUPABASE_URL || '');
if (PROD && !process.argv.includes('--i-mean-prod')) {
  throw new Error('.env.local points at production. Refusing. Pass --i-mean-prod if that is really the intent.');
}

/* Order matters only for readability; there are no foreign keys between them. */
const TABLES = [
  { name: 'creators', order: 'id' },
  { name: 'activity_logs', order: 'id' },
  { name: 'app_users', order: 'id' },
  { name: 'app_settings', order: 'id' },
  { name: 'join_requests', order: 'id' },
  { name: 'brand_monthly_budgets', order: 'id' },
  { name: 'revoked_sessions', order: 'session_id' },
  { name: 'audit_logs', order: 'id' },
];

/* Identity columns whose sequence has to be moved past the copied rows. */
const IDENTITY = ['creators', 'activity_logs', 'join_requests'];

const PAGE = 1000;

async function req(url, opts, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(45000) });
      if (r.status >= 500 && i < tries - 1) {
        await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
        continue;
      }
      return r;
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((s) => setTimeout(s, 2000 * (i + 1)));
    }
  }
}

const theirHeaders = { apikey: THEIRS.key, Authorization: `Bearer ${THEIRS.key}` };
const ourHeaders = {
  apikey: OURS.key,
  Authorization: `Bearer ${OURS.key}`,
  'Content-Type': 'application/json',
  'Accept-Profile': 'wurxbase',
  'Content-Profile': 'wurxbase',
};

async function countOf(base, table, headers) {
  const r = await req(`${base}/rest/v1/${table}?select=*`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  });
  if (!r.ok) return `HTTP ${r.status}`;
  return Number((r.headers.get('content-range') || '').split('/')[1] ?? 0);
}

async function readAll(table, order) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const r = await req(`${THEIRS.url}/rest/v1/${table}?select=*&order=${order}.asc`, {
      headers: { ...theirHeaders, Range: `${from}-${from + PAGE - 1}` },
    });
    if (!r.ok) throw new Error(`read ${table}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    const page = await r.json();
    rows.push(...page);
    if (page.length < PAGE) break;
    if (rows.length > 500000) throw new Error(`read ${table}: runaway paging`);
  }
  return rows;
}

/*
 * OUR columns for a table, straight from PostgREST's own schema description.
 *
 * WHY THIS EXISTS, AND IT IS NOT THEORETICAL. This script reads `select=*` from
 * theirs and posts the rows here verbatim. That is fine only while the two
 * tables have identical columns — and on 2026-08-29 they stopped: we dropped
 * `app_users.password`, theirs still has it. The next run would have DELETED
 * every row in our `app_users` and then failed on the insert, because
 * PostgREST rejects an unknown column. Their whole team's roles gone, and the
 * eight of them dropping to the derived role, which is the exact permission
 * leak the hub_email column exists to prevent.
 *
 * Reading our own columns and projecting onto them makes any future drift a
 * printed line instead of an outage.
 */
let ourColumns = null;
async function columnsOf(table) {
  if (!ourColumns) {
    const r = await req(`${OURS.url}/rest/v1/`, { headers: ourHeaders });
    if (!r.ok) throw new Error(`could not read our schema: HTTP ${r.status}`);
    const spec = await r.json();
    ourColumns = {};
    for (const [name, def] of Object.entries(spec.definitions || {})) {
      ourColumns[name] = new Set(Object.keys(def.properties || {}));
    }
  }
  return ourColumns[table] || null;
}

async function write(table, rows) {
  /*
   * PROJECT BEFORE DELETING. The delete below is irreversible, so anything
   * that could make the insert fail has to be dealt with first.
   */
  const cols = await columnsOf(table);
  if (cols && cols.size) {
    const theirKeys = new Set(rows.flatMap((r) => Object.keys(r)));
    const dropped = [...theirKeys].filter((k) => !cols.has(k));
    if (dropped.length) {
      console.log(`  · ${table}: ignoring ${dropped.length} column(s) we do not have — ${dropped.join(', ')}`);
      rows = rows.map((r) => {
        const out = {};
        for (const k of Object.keys(r)) if (cols.has(k)) out[k] = r[k];
        return out;
      });
    }
    const missing = [...cols].filter((k) => !theirKeys.has(k));
    if (missing.length) {
      console.log(`  · ${table}: ${missing.join(', ')} exists here and not there — it will be left empty`);
    }
  } else {
    console.log(`  ! ${table}: could not read our columns; copying as-is`);
  }

  /* Clear first, so a re-run is a replacement rather than a merge. */
  const del = await req(`${OURS.url}/rest/v1/${table}?id=not.is.null`, {
    method: 'DELETE',
    headers: { ...ourHeaders, Prefer: 'return=minimal' },
  });
  if (!del.ok && del.status !== 404) {
    /* revoked_sessions has no `id`; clear it on its own key. */
    const alt = await req(`${OURS.url}/rest/v1/${table}?session_id=not.is.null`, {
      method: 'DELETE',
      headers: { ...ourHeaders, Prefer: 'return=minimal' },
    });
    if (!alt.ok) throw new Error(`clear ${table}: HTTP ${alt.status} ${(await alt.text()).slice(0, 140)}`);
  }
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500);
    const r = await req(`${OURS.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { ...ourHeaders, Prefer: 'return=minimal' },
      body: JSON.stringify(batch),
    });
    if (!r.ok) throw new Error(`write ${table} rows ${i}-${i + batch.length}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  }
}

const verifyOnly = process.argv.includes('--verify');
console.log(`${verifyOnly ? 'verifying' : 'copying'}  ${THEIRS.url.split('//')[1].split('.')[0]}  ->  ${OURS.url.split('//')[1].split('.')[0]}.wurxbase\n`);

const summary = [];
for (const { name, order } of TABLES) {
  const theirs = await countOf(THEIRS.url, name, theirHeaders);
  if (!verifyOnly) {
    if (typeof theirs === 'number' && theirs > 0) {
      const rows = await readAll(name, order);
      if (rows.length !== theirs) {
        console.log(`  ! ${name}: their count says ${theirs} but paging returned ${rows.length}; copying what was read`);
      }
      await write(name, rows);
    }
  }
  const ours = await countOf(OURS.url, name, ourHeaders);
  /*
   * A SOURCE TABLE WITH NO ROWS IS NOT A MISMATCH.
   *
   * `app_settings` is empty over there and holds one row here, because their
   * own `fetchSettings` upserts `{ id: 1 }` the first time it finds nothing.
   * Ours is therefore a row THEIR code wrote, not drift. Comparing counts
   * flagged it FAIL on every run, and a check that cries wolf gets ignored
   * exactly when it is telling the truth.
   *
   * Nothing can be lost when the source is empty, so there is nothing to
   * assert. Say what is there and move on.
   */
  const sourceEmpty = theirs === 0;
  const ok = sourceEmpty || theirs === ours;
  summary.push({ name, theirs, ours, ok });
  const note = sourceEmpty && ours > 0 ? '   (source empty; ours holds ' + ours + ' written here)' : '';
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(24)} theirs ${String(theirs).padStart(5)}   ours ${String(ours).padStart(5)}${note}`);
}

const bad = summary.filter((s) => !s.ok);
console.log(
  `\n${summary.length - bad.length} of ${summary.length} tables match.` +
    (bad.length ? `  MISMATCHED: ${bad.map((b) => b.name).join(', ')}` : ''),
);
if (!verifyOnly) {
  console.log(
    '\nNow move the identity sequences past the copied ids, or the next insert collides:\n' +
      IDENTITY.map((t) => `  select setval(pg_get_serial_sequence('wurxbase.${t}','id'), coalesce((select max(id) from wurxbase.${t}), 1));`).join('\n'),
  );
}
process.exit(bad.length ? 1 : 0);
