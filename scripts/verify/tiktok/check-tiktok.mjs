#!/usr/bin/env node
/**
 * TikTok integration: the security suite.
 *
 * The access token this feature stores reads a client's LIVE AD SPEND. So the
 * question this file answers is not "does the screen work", it is "can anybody
 * who is not the service role get at the token, or at the mapping that decides
 * whose spend a creator is shown".
 *
 * It attacks the database as a real signed-in creator and a real signed-in
 * admin, because that is the only honest way to check RLS. A policy nobody has
 * tried to break is a policy nobody knows the shape of.
 *
 * It also proves the two things that are easy to get wrong and impossible to
 * see from the outside:
 *   - the nonce is genuinely single use, so a replayed callback loses;
 *   - the admin function refuses a creator, and says so in the audit log.
 *
 * Run against DEV only. Needs SUPABASE_SERVICE_KEY in the environment.
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

const URL = env.VITE_SUPABASE_URL;

// Creates and deletes data. Dev only, checked before anything runs.
assertDevProject(URL, 'check-tiktok.mjs');
const PUBLISHABLE = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;

if (!URL || !PUBLISHABLE) throw new Error('.env.local is missing the Supabase URL or key');
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set in the environment');

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anonClient = () => createClient(URL, PUBLISHABLE, { auth: { persistSession: false } });

let failures = 0;
const pass = (m) => console.log(`  PASS  ${m}`);
const fail = (m, d) => {
  console.error(`  FAIL  ${m}${d ? `\n        ${d}` : ''}`);
  failures++;
};
const check = (cond, m, d) => (cond ? pass(m) : fail(m, d));

const stamp = process.env.RUN_STAMP ?? String(Date.now()).slice(-6);
const PASSWORD = 'a-long-enough-test-password-1';
const created = [];
const madeStores = [];
const madeStates = [];
let madeConnection = null;

async function makeUser(role) {
  const email = `tt-${role}-${stamp}@wurxmediahub.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`could not create the ${role}: ${error.message}`);
  created.push(data.user.id);
  await admin.from('profiles').update({ role, is_active: true }).eq('id', data.user.id);

  const client = anonClient();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signInErr) throw new Error(`could not sign the ${role} in: ${signInErr.message}`);
  return { client, id: data.user.id, email };
}

async function cleanup() {
  if (madeStores.length) {
    await admin.from('tiktok_stores').delete().in('store_id', madeStores);
  }
  if (madeConnection) {
    // Cascades the ad account and anything hanging off it.
    await admin.from('tiktok_connections').delete().eq('id', madeConnection);
  }
  if (madeStates.length) {
    await admin.from('tiktok_oauth_states').delete().in('state', madeStates);
  }
  for (const id of created) {
    await admin.from('audit_log').delete().eq('actor_id', id);
    await admin.auth.admin.deleteUser(id);
  }
}

console.log(`\nTikTok integration against ${URL}\n${'='.repeat(70)}\n`);

try {
  /* ------------------------------------------------ [0] a connection to poke */
  console.log('[0] A connection to attack');

  const { data: conn, error: connErr } = await admin
    .from('tiktok_connections')
    .insert({
      access_token: `fake-token-${stamp}`,
      scope: 'test',
      granted_advertiser_ids: ['7427187763989987329'],
    })
    .select('id')
    .single();
  check(!connErr && conn, 'the service role can store a connection', connErr?.message);
  madeConnection = conn?.id ?? null;

  const advertiserId = `9${stamp}${'0'.repeat(Math.max(0, 12 - stamp.length))}`.slice(0, 16);
  const { error: acctErr } = await admin.from('tiktok_ad_accounts').insert({
    advertiser_id: advertiserId,
    connection_id: madeConnection,
    name: `Test account ${stamp}`,
    currency: 'USD',
    timezone: 'America/New_York',
  });
  check(!acctErr, 'the service role can store an ad account', acctErr?.message);

  const storeId = `8${stamp}${'0'.repeat(Math.max(0, 12 - stamp.length))}`.slice(0, 16);
  const { error: storeErr } = await admin.from('tiktok_stores').insert({
    store_id: storeId,
    advertiser_id: advertiserId,
    name: `Test store ${stamp}`,
    store_authorized_bc_id: '7427186406432358416',
  });
  check(!storeErr, 'the service role can store a shop', storeErr?.message);
  if (!storeErr) madeStores.push(storeId);

  /*
   * THE SAME STORE UNDER A SECOND AD ACCOUNT.
   *
   * This is not a hypothetical: Rashid's Penetrex store comes back on both of
   * his ad accounts, because they share a Business Center, and it arrives with
   * `is_gmv_max_available: true` from one and `false` from the other. When the
   * primary key was `store_id` alone the second upsert overwrote the first, so
   * the row ended up filed under whichever advertiser happened to go last and
   * carrying the wrong flag. Every report call is made for a specific
   * advertiser, so that is a route to putting one account's spend on another
   * account's video: wrong, silently, in money.
   */
  const secondAdvertiserId = `7${stamp}${'0'.repeat(Math.max(0, 12 - stamp.length))}`.slice(0, 16);
  await admin.from('tiktok_ad_accounts').insert({
    advertiser_id: secondAdvertiserId,
    connection_id: madeConnection,
    name: `Second account ${stamp}`,
  });
  const { error: pairErr } = await admin.from('tiktok_stores').insert({
    store_id: storeId,
    advertiser_id: secondAdvertiserId,
    name: `Test store ${stamp}`,
    is_gmv_max_available: false,
  });
  check(!pairErr, 'the same store can also belong to a second ad account', pairErr?.message);

  {
    const { count } = await admin
      .from('tiktok_stores')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', storeId);
    check(count === 2, 'and both pairs survive, rather than one overwriting the other');
  }

  /* ----------------------------------------------------- [1] a signed out eye */
  console.log('\n[1] Signed out');
  const out = anonClient();

  for (const table of [
    'tiktok_connections',
    'tiktok_oauth_states',
    'tiktok_ad_accounts',
    'tiktok_stores',
    'tiktok_connection_health',
    'tiktok_account_map',
  ]) {
    const { data, error } = await out.from(table).select('*').limit(5);
    check(
      error !== null || (data ?? []).length === 0,
      `signed out, ${table} gives nothing`,
      `returned ${(data ?? []).length} row(s)`
    );
  }

  /* --------------------------------------------------------- [2] a creator -- */
  console.log('\n[2] A signed-in creator');
  const creator = await makeUser('creator');

  for (const table of [
    'tiktok_connections',
    'tiktok_oauth_states',
    'tiktok_ad_accounts',
    'tiktok_stores',
    'tiktok_connection_health',
    'tiktok_account_map',
  ]) {
    const { data, error } = await creator.client.from(table).select('*').limit(5);
    check(
      error !== null || (data ?? []).length === 0,
      `a creator cannot read ${table}`,
      `returned ${(data ?? []).length} row(s)`
    );
  }

  /* ----------------------------------------------------------- [3] an admin - */
  console.log('\n[3] A signed-in admin');
  const adminUser = await makeUser('admin');

  /*
   * THE HEADLINE CHECK. An admin manages the connection but must never be able
   * to read the credential, because a token a browser can hold is a token that
   * can leak from one. `tiktok_connections` has RLS on and no policies at all,
   * so this must come back empty for an admin exactly as it does for anyone.
   */
  {
    const { data, error } = await adminUser.client.from('tiktok_connections').select('*');
    check(
      error !== null || (data ?? []).length === 0,
      'AN ADMIN CANNOT READ THE ACCESS TOKEN',
      `returned ${(data ?? []).length} row(s) — the token is exposed`
    );
  }

  {
    const { data, error } = await adminUser.client.from('tiktok_oauth_states').select('*');
    check(
      error !== null || (data ?? []).length === 0,
      'an admin cannot read the OAuth nonces',
      `returned ${(data ?? []).length} row(s)`
    );
  }

  // ...but must be able to run the screen.
  {
    const { data, error } = await adminUser.client
      .from('tiktok_account_map')
      .select('*')
      .eq('store_id', storeId)
      .eq('advertiser_id', advertiserId);
    check(!error && (data ?? []).length === 1, 'an admin CAN read the account map', error?.message);
    const row = (data ?? [])[0];
    check(
      row?.advertiser_name === `Test account ${stamp}` && row?.currency === 'USD',
      'and it carries the account name and currency'
    );
    check(
      !('access_token' in (row ?? {})),
      'and the map view carries no token column'
    );
  }

  {
    const { data, error } = await adminUser.client
      .from('tiktok_connection_health')
      .select('*')
      .eq('id', madeConnection);
    check(!error && (data ?? []).length === 1, 'an admin CAN read connection health', error?.message);
    check(
      !('access_token' in ((data ?? [])[0] ?? {})),
      'and connection health carries no token column'
    );
  }

  /* ------------------------------------------- [4] the mapping is not writable */
  console.log('\n[4] The brand mapping is server-side only');

  {
    const { data, error } = await adminUser.client
      .from('tiktok_stores')
      .update({ brand_id: null, name: 'renamed by a browser' })
      .eq('store_id', storeId)
      .select('store_id');
    check(
      error !== null || (data ?? []).length === 0,
      'an admin cannot rewrite a mapping straight from the browser',
      'the update was accepted'
    );
  }

  {
    const { error } = await adminUser.client
      .from('tiktok_ad_accounts')
      .insert({ advertiser_id: '123456789012', connection_id: madeConnection, name: 'injected' });
    check(error !== null, 'an admin cannot invent an ad account from the browser');
    if (!error) await admin.from('tiktok_ad_accounts').delete().eq('advertiser_id', '123456789012');
  }

  {
    const { error } = await adminUser.client
      .from('tiktok_connections')
      .insert({ access_token: 'injected' });
    check(error !== null, 'nobody can insert a connection from the browser');
  }

  /* ---------------------------------------------------- [5] the nonce burns -- */
  console.log('\n[5] The OAuth nonce is single use');

  const state = `test-state-${stamp}-${'a'.repeat(20)}`;
  madeStates.push(state);
  await admin.from('tiktok_oauth_states').insert({
    state,
    started_by: adminUser.id,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });

  const burn = () =>
    admin
      .from('tiktok_oauth_states')
      .update({ used_at: new Date().toISOString() })
      .eq('state', state)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('state')
      .maybeSingle();

  const first = await burn();
  check(Boolean(first.data), 'the first callback wins the nonce');
  const second = await burn();
  check(!second.data, 'and a replayed callback gets nothing');

  const expired = `test-expired-${stamp}-${'b'.repeat(18)}`;
  madeStates.push(expired);
  await admin.from('tiktok_oauth_states').insert({
    state: expired,
    started_by: adminUser.id,
    expires_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const stale = await admin
    .from('tiktok_oauth_states')
    .update({ used_at: new Date().toISOString() })
    .eq('state', expired)
    .is('used_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('state')
    .maybeSingle();
  check(!stale.data, 'an expired nonce is refused');

  /* ------------------------------------------------- [6] the function's door - */
  console.log('\n[6] The edge function checks the caller');

  const callConnect = async (client, body) => {
    const { data: sess } = await client.auth.getSession();
    const res = await fetch(`${URL}/functions/v1/tiktok-connect`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE,
        Authorization: `Bearer ${sess?.session?.access_token ?? PUBLISHABLE}`,
        'x-region': 'ap-northeast-1',
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  {
    const res = await callConnect(creator.client, { action: 'connect.start' });
    check(res.status === 403, 'a creator is refused by tiktok-connect', `got ${res.status}`);
  }

  {
    const { count } = await admin
      .from('audit_log')
      .select('*', { count: 'exact', head: true })
      .eq('actor_id', creator.id)
      .eq('action', 'tiktok.write_denied');
    check((count ?? 0) > 0, 'and the refusal is in the audit log');
  }

  {
    const res = await callConnect(adminUser.client, {
      action: 'store.map',
      advertiserId,
      storeId,
      brandId: null,
    });
    check(res.status === 200, 'an admin CAN clear a mapping through the function', JSON.stringify(res.body));
  }

  {
    const res = await callConnect(adminUser.client, {
      action: 'store.map',
      advertiserId,
      storeId,
      brandId: '00000000-0000-0000-0000-000000000000',
    });
    check(res.status === 400, 'and a brand that does not exist is refused', `got ${res.status}`);
  }

  /* ------------------------------------------ [7] the callback rejects rubbish */
  console.log('\n[7] The public callback refuses what it should');

  const callCallback = async (body) => {
    const res = await fetch(`${URL}/functions/v1/tiktok-callback`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: PUBLISHABLE,
        'x-region': 'ap-northeast-1',
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  {
    const res = await callCallback({ authCode: 'x'.repeat(20), state: 'y'.repeat(40) });
    check(res.status === 400, 'an unknown state is refused', `got ${res.status}`);
    check(
      !/already been used|expired|unknown/i.test(res.body?.error ?? '') ||
        /no longer valid/i.test(res.body?.error ?? ''),
      'and the refusal does not say WHICH reason, so nonces cannot be probed'
    );
  }

  {
    const res = await callCallback({ authCode: 'x'.repeat(20), state: state });
    check(res.status === 400, 'an already-burned state is refused', `got ${res.status}`);
  }

  {
    const res = await callCallback({ nonsense: true });
    check(res.status === 400, 'a malformed body is refused');
  }
} catch (e) {
  fail('the suite itself threw', e.message);
} finally {
  await cleanup();
  console.log('\n  cleaned up');
}

console.log(`\n${'='.repeat(70)}`);
if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED.\n`);
  process.exit(1);
}
console.log('\nEvery check passed.\n');
process.exit(0);
