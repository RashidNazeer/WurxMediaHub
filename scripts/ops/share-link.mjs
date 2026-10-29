#!/usr/bin/env node
/**
 * CLIENT SHARE LINKS, FROM THE TERMINAL, until the admin screen exists.
 *
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/share-link.mjs list
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/share-link.mjs new "Apothecary - Sarah" Apothecary[,Penetrex] [days] [sections]
 *   SUPABASE_SERVICE_KEY=... node scripts/ops/share-link.mjs revoke <id>
 *
 * `sections` is four letters from k (top numbers), t (top videos), c (creators)
 * and v (videos); the default is all four. `node scripts/ops/share-link.mjs new
 * "X" Apothecary 30 cv` shares the creators and their videos only.
 *
 * THE LINK IS PRINTED ONCE AND IS NOT RECOVERABLE. Only its SHA-256 is stored,
 * on purpose (DECISIONS, 2026-09-17). Lost link, new link.
 *
 * NOT THROUGH THE SQL EDITOR OR THE MANAGEMENT API. Those run as `postgres`,
 * whose JWT is not the service role, so `collab_share_create` refuses them —
 * which is the gate working, not a bug.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { assertDevProject } from '../lib/dev-guard.mjs';
const require = createRequire(process.cwd() + '/package.json');
const { createClient } = require('@supabase/supabase-js');

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter((l) => l.includes('='))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const URL_ = process.env.ALLOW_PROD === 'yes' ? env.VITE_SUPABASE_URL : assertDevProject(env.VITE_SUPABASE_URL);
if (!process.env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY must be set');
const svc = createClient(URL_, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const SITE = process.env.SITE_URL || 'https://wurxmediahubdev.vercel.app';
const [cmd, ...rest] = process.argv.slice(2);

if (cmd === 'list') {
  const { data, error } = await svc.rpc('collab_share_list');
  if (error) throw error;
  if (!data?.length) console.log('no links yet');
  for (const l of data ?? []) {
    const parts = [l.show_kpis && 'numbers', l.show_top_videos && 'top videos', l.show_creators && 'creators', l.show_videos && 'videos'].filter(Boolean);
    console.log(`${l.is_live ? 'LIVE   ' : 'ended  '} ${l.id}  ${l.token_hint}…  ${l.label}`);
    console.log(`         ${l.brands.join(', ')} · ${parts.join(' + ')} · ${l.view_count} view${l.view_count === 1 ? '' : 's'}${l.last_viewed_at ? `, last ${new Date(l.last_viewed_at).toLocaleString()}` : ''}`);
    console.log(`         ${l.revoked_at ? `revoked ${new Date(l.revoked_at).toLocaleDateString()}` : `until ${new Date(l.expires_at).toLocaleDateString()}`}`);
  }
} else if (cmd === 'new') {
  const [label, brandList, days = '90', sections = 'ktcv'] = rest;
  if (!label || !brandList) throw new Error('usage: new "<label>" <Brand[,Brand]> [days] [sections: k t c v]');
  const { data, error } = await svc.rpc('collab_share_create', {
    p_label: label,
    p_brands: brandList.split(',').map((b) => b.trim()).filter(Boolean),
    p_days: Number(days),
    p_show_kpis: sections.includes('k'),
    p_show_top_videos: sections.includes('t'),
    p_show_creators: sections.includes('c'),
    p_show_videos: sections.includes('v'),
  });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  console.log(`\n  ${SITE}/share/collabs/${row.token}\n`);
  console.log(`  id ${row.id} · expires ${new Date(row.expires_at).toLocaleDateString()}`);
  console.log('  This is the only time the link is shown. Copy it now.\n');
} else if (cmd === 'revoke') {
  const [id] = rest;
  if (!id) throw new Error('usage: revoke <id>');
  const { data, error } = await svc.rpc('collab_share_revoke', { p_id: id });
  if (error) throw error;
  console.log(`revoked at ${new Date(data).toLocaleString()}`);
} else {
  console.log('usage: share-link.mjs list | new "<label>" <Brand[,Brand]> [days] [sections] | revoke <id>');
  process.exit(1);
}
