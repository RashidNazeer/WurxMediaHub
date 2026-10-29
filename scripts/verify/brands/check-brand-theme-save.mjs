#!/usr/bin/env node
/**
 * Can an admin actually SAVE a multi-colour theme, and can anybody smuggle a
 * text colour past us on the way?
 *
 * `check-brand-theme.mjs` proves the maths: whatever an admin picks derives a
 * readable hub. This proves the PIPE. Those are different failures and only one
 * of them is caught by pure functions:
 *
 *   browser Zod  ->  Edge Function Zod  ->  save_brand_about  ->  the column
 *
 * Every one of those four is meant to refuse the same things, and three of them
 * are only reachable over the network. The one that matters most is the fourth
 * assertion below: **no text colour may ever be stored.** The whole readability
 * guarantee rests on an admin choosing FILLS and the product computing INKS, so
 * an unknown key sailing through a permissive object would remove that
 * guarantee silently, for every brand, with nothing failing anywhere.
 *
 * It makes its own admin, its own brand, and removes both. It never touches a
 * real brand, so it is safe to run against dev at any time.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/brands/check-brand-theme-save.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { assertDevProject } from '../../lib/dev-guard.mjs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('='))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

assertDevProject(env.VITE_SUPABASE_URL, 'check-brand-theme-save.mjs');
const URL_BASE = env.VITE_SUPABASE_URL;
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(URL_BASE, SERVICE, { auth: { persistSession: false } });

const stamp = Date.now();
const STAFF = { email: `theme-admin-${stamp}@wurx.test`, password: 'ThemeAdmin!2026' };
const SPY = { email: `theme-spy-${stamp}@wurx.test`, password: 'ThemeSpy!2026' };

let pass = 0;
let fail = 0;
const ok = (label) => {
  console.log(`  PASS  ${label}`);
  pass++;
};
const bad = (label, detail) => {
  console.error(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`);
  fail++;
};

const made = [];
let brandId = null;

try {
  /* ------------------------------------------------------ the cast -- */
  for (const who of [STAFF, SPY]) {
    const { data, error } = await admin.auth.admin.createUser({
      email: who.email,
      password: who.password,
      email_confirm: true,
    });
    if (error) throw error;
    who.id = data.user.id;
    made.push(who.id);
  }
  await admin.from('profiles').update({ role: 'admin' }).eq('id', STAFF.id);
  await admin.from('profiles').update({ role: 'creator' }).eq('id', SPY.id);

  const { data: brand, error: brandErr } = await admin
    .from('brands')
    .insert({ name: `Theme test ${stamp}`, slug: `theme-test-${stamp}`, store_id: `TS${stamp}` })
    .select('id')
    .single();
  if (brandErr) throw brandErr;
  brandId = brand.id;

  const tokenFor = async (who) => {
    const c = createClient(URL_BASE, PUBLISHABLE, { auth: { persistSession: false } });
    const { data, error } = await c.auth.signInWithPassword({
      email: who.email,
      password: who.password,
    });
    if (error) throw error;
    return data.session.access_token;
  };

  const call = async (token, body) => {
    const res = await fetch(`${URL_BASE}/functions/v1/manage-brand`, {
      method: 'POST',
      headers: {
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, text: (await res.text()).slice(0, 300) };
  };

  const staffToken = await tokenFor(STAFF);
  const spyToken = await tokenFor(SPY);

  const about = (theme) => ({
    action: 'brand.about',
    brandId,
    logoUrl: null,
    tagline: null,
    description: null,
    brandColor: '#dc0945',
    heroUrl: null,
    theme,
  });

  const stored = async () => {
    const { data } = await admin.from('brands').select('theme').eq('id', brandId).single();
    return data.theme;
  };

  console.log('\n[1] An admin can save a full four-area theme');
  const full = {
    v: 1,
    hero: { stops: ['#dc0945', '#1d3149', '#c8924b', '#0a0a0a'], angle: 40, tone: 'light' },
    rail: { stops: ['#1d3149', '#0a0a0a'] },
    page: { stops: ['#dc0945', '#1d3149'] },
    accent: { stops: ['#dc0945', '#c8924b'] },
  };
  let r = await call(staffToken, about(full));
  if (r.status === 200) ok('saved');
  else bad('a full theme was refused', `${r.status} ${r.text}`);

  const back = await stored();
  if (back?.hero?.stops?.length === 4 && back.hero.angle === 40 && back.hero.tone === 'light') {
    ok('it comes back with all four hero stops, the angle and the tone');
  } else {
    bad('the stored theme is not what was sent', JSON.stringify(back));
  }

  console.log('\n[2] A TEXT COLOUR CANNOT BE STORED, which is the whole guarantee');
  /*
   * The one that would be invisible. A permissive object would strip `text` on
   * the way through and store a theme that LOOKS right, and the day somebody
   * changed the reader to honour it, every brand would lose its readability
   * floor at once. So it is refused loudly instead of stripped quietly.
   */
  r = await call(staffToken, about({ v: 1, hero: { stops: ['#000000'], text: '#ff0000' } }));
  if (r.status >= 400) ok('an unknown key on an area is refused');
  else bad('a text colour was accepted', r.text);

  const afterSmuggle = await stored();
  if (afterSmuggle?.hero?.stops?.length === 4) ok('and the good theme is untouched');
  else bad('the refused call still changed the row', JSON.stringify(afterSmuggle));

  console.log('\n[3] The shape rules hold over the wire');
  const refuse = async (label, theme) => {
    const res = await call(staffToken, about(theme));
    if (res.status >= 400) ok(label);
    else bad(`accepted ${label}`, res.text);
  };
  await refuse('five hero stops', {
    v: 1,
    hero: { stops: ['#000000', '#111111', '#222222', '#333333', '#444444'] },
  });
  await refuse('four menu stops', {
    v: 1,
    rail: { stops: ['#000000', '#111111', '#222222', '#333333'] },
  });
  await refuse('an empty stop list', { v: 1, hero: { stops: [] } });
  await refuse('a colour that is not a colour', { v: 1, hero: { stops: ['red'] } });
  await refuse('an angle of 400', { v: 1, hero: { stops: ['#000000'], angle: 400 } });
  await refuse('an unknown area', { v: 1, footer: { stops: ['#000000'] } });
  await refuse('a future version', { v: 2, hero: { stops: ['#000000'] } });

  console.log('\n[4] Null puts a brand back to one colour');
  r = await call(staffToken, about(null));
  if (r.status === 200 && (await stored()) === null) ok('cleared');
  else bad('clearing the theme did not work', `${r.status} ${r.text}`);

  console.log('\n[5] A creator cannot repaint a brand');
  /*
   * Hiding the control is never the boundary. The Edge Function re-reads the
   * caller's role from `profiles` server side, and this is the assertion that
   * says so out loud rather than trusting the screen not to render a form.
   */
  r = await call(spyToken, about(full));
  if (r.status === 401 || r.status === 403) ok(`a signed-in creator is refused (${r.status})`);
  else bad('a creator changed a brand theme', `${r.status} ${r.text}`);

  const anon = await fetch(`${URL_BASE}/functions/v1/manage-brand`, {
    method: 'POST',
    headers: { apikey: PUBLISHABLE, 'Content-Type': 'application/json' },
    body: JSON.stringify(about(full)),
  });
  if (anon.status === 401 || anon.status === 403) ok(`a signed-out caller is refused (${anon.status})`);
  else bad('an anonymous caller changed a brand theme', String(anon.status));

  if ((await stored()) !== null) bad('a refused caller still changed the row');
  else ok('and neither of them changed the row');
} finally {
  if (brandId) await admin.from('brands').delete().eq('id', brandId);
  for (const id of made) await admin.auth.admin.deleteUser(id);
  console.log('\n[cleanup] test brand and accounts removed');
}

console.log('\n' + '='.repeat(70));
if (fail) {
  console.error(`${fail} failed, ${pass} passed.\n`);
  process.exit(1);
}
console.log(`${pass} checks passed. Fills go in, inks are computed, and nothing else gets stored.\n`);
