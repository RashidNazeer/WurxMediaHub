#!/usr/bin/env node
/**
 * The leaderboard suite.
 *
 * THIS SCREEN IS THE ONLY PLACE IN THE PRODUCT WHERE ONE CREATOR SEES ANOTHER
 * CREATOR'S FIGURES, so most of this file is about what it must NOT hand over.
 * It amends D7 on Rashid's explicit decision of 2026-08-20, and an amendment
 * that quietly widened into a directory would be the worst possible outcome.
 *
 * Everything runs as a REAL signed-in creator over the wire, never with the
 * service key, because a function that looks right to an admin proves nothing
 * about what row security does to somebody else.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/verify/creator/check-leaderboard.mjs
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

const URL_ = env.VITE_SUPABASE_URL;
assertDevProject(URL_, 'check-leaderboard.mjs');
const PUB = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
if (!SERVICE) throw new Error('SUPABASE_SERVICE_KEY must be set');

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const anon = () => createClient(URL_, PUB, { auth: { persistSession: false } });

let pass = 0;
let fail = 0;
const ok = (m) => {
  pass += 1;
  console.log(`  PASS  ${m}`);
};
const bad = (m, d) => {
  fail += 1;
  console.error(`  FAIL  ${m}${d ? `\n        ${d}` : ''}`);
};
const check = (m, cond, d) => (cond ? ok(m) : bad(m, d));

const STAMP = Date.now().toString(36);
const PW = 'Wx-board-suite-2026!';
const ALL = { p_from: '2000-01-01', p_to: new Date().toISOString().slice(0, 10) };

const made = { users: [], brand: null, offer: null, application: null, items: [] };

async function makeCreator(tag) {
  const email = `board-${tag}-${STAMP}@wurxmediahub.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  if (error) throw new Error(`could not create ${tag}: ${error.message}`);
  made.users.push(data.user.id);
  await admin
    .from('profiles')
    .update({ role: 'creator', tier: 'creator', is_active: true, display_name: `Board ${tag} ${STAMP}` })
    .eq('id', data.user.id);
  const client = anon();
  const { error: sErr } = await client.auth.signInWithPassword({ email, password: PW });
  if (sErr) throw new Error(`could not sign in ${tag}: ${sErr.message}`);
  return { id: data.user.id, email, client };
}

/*
 * CLEANUP THAT SAYS WHEN IT FAILED.
 *
 * This used to throw every delete away: `await admin.auth.admin.deleteUser(id)`
 * returns an error, it does not raise one, so a refused delete looked exactly
 * like a successful one and the run still printed a clean summary. That is how
 * `board-suspended-mt1paj3d@wurxmediahub.test` was still sitting in dev on
 * 2026-08-21, a day after the suite that made it reported itself finished.
 *
 * Two rules now, and they are the same two `check-content` learned the hard
 * way: every delete is CHECKED, and every step is isolated so one failure
 * cannot skip the steps after it. Litter that is announced gets cleared up;
 * litter that is silent gets found by Rashid.
 */
async function cleanup() {
  const failures = [];
  const step = async (what, fn) => {
    try {
      const { error } = (await fn()) ?? {};
      if (error) failures.push(`${what}: ${error.message}`);
    } catch (e) {
      failures.push(`${what}: ${e?.message ?? e}`);
    }
  };

  for (const id of made.items)
    await step(`money rows for ${id}`, () =>
      admin.from('tiktok_video_daily').delete().eq('item_id', id)
    );

  if (made.brand)
    await step('content submissions', () =>
      admin.from('content_submissions').delete().eq('brand_id', made.brand)
    );
  if (made.application)
    await step('the application', () =>
      admin.from('offer_applications').delete().eq('id', made.application)
    );
  if (made.offer) await step('the offer', () => admin.from('offers').delete().eq('id', made.offer));

  for (const id of made.users) {
    await step(`audit rows by ${id}`, () => admin.from('audit_log').delete().eq('actor_id', id));
    await step(`audit rows about ${id}`, () =>
      admin.from('audit_log').delete().eq('target_user_id', id)
    );
    await step(`the account ${id}`, () => admin.auth.admin.deleteUser(id));
  }

  if (made.brand) await step('the brand', () => admin.from('brands').delete().eq('id', made.brand));

  if (failures.length) {
    console.error('\nCLEANUP LEFT THINGS BEHIND. Remove these by hand:');
    for (const f of failures) console.error(`  ${f}`);
    // A suite that litters has not passed, whatever its assertions said.
    process.exitCode = 1;
  }
}

console.log(`\nLeaderboard suite against ${URL_}\n${'='.repeat(70)}\n`);

try {
  /* ------------------------------------------------------- [0] the setup -- */
  console.log('[0] Two creators, one with sales and one without');

  const rich = await makeCreator('rich');
  const poor = await makeCreator('poor');

  const { data: brand, error: bErr } = await admin
    .from('brands')
    .insert({
      name: `Board Suite ${STAMP}`,
      slug: `board-suite-${STAMP}`,
      store_id: `board-suite-${STAMP}`,
      is_active: true,
    })
    .select('id')
    .single();
  if (bErr) throw new Error(`brand: ${bErr.message}`);
  made.brand = brand.id;

  const { data: offer } = await admin
    .from('offers')
    .insert({
      brand_id: made.brand,
      title: 'Board suite offer',
      description: 'For the suite.',
      video_count: 2,
      reward_amount: 100,
      currency: 'USD',
      status: 'active',
    })
    .select('id')
    .single();
  made.offer = offer.id;

  const { data: app } = await admin
    .from('offer_applications')
    .insert({
      offer_id: made.offer,
      brand_id: made.brand,
      creator_id: rich.id,
      status: 'approved',
      committed_video_count: 2,
      committed_amount: 100,
    })
    .select('id')
    .single();
  made.application = app.id;

  /*
   * THREE VIDEOS, and the difference between them is the whole gate. One is
   * approved and carries money. One is the SAME video filed against a second
   * job, which is legal and is exactly the shape that would double count a
   * creator's GMV on a board that sums across people. One is unapproved and
   * also carries money, so "unapproved work does not put you on the board" is a
   * real question rather than an absence.
   */
  /*
   * DIGITS ONLY. `tiktok_video_daily.item_id` is checked against
   * `^[0-9]{6,32}$`, because a real TikTok id is a number and a filter built
   * from anything else would be sent to their API and refused there instead.
   * The first version of this suite built ids out of `STAMP`, which is base 36,
   * and every one of them carried letters.
   */
  const DIGITS = String(Date.now()).slice(-15);
  const RICH_ITEM = `91${DIGITS}01`;
  const HIDDEN_ITEM = `91${DIGITS}02`;
  made.items.push(RICH_ITEM, HIDDEN_ITEM);

  const mkVideo = async (creatorId, item, status) => {
    const { error } = await admin.from('content_submissions').insert({
      application_id: made.application,
      creator_id: creatorId,
      brand_id: made.brand,
      offer_id: made.offer,
      video_url: `https://www.tiktok.com/@boardsuite/video/${item}${status === 'approved' ? '' : 'x'}`,
      ad_code: `BOARD${STAMP}${status[0]}`,
      ad_authorized: true,
      embed_id: item,
      status,
    });
    if (error) throw new Error(`seed video: ${error.message}`);
  };

  await mkVideo(rich.id, RICH_ITEM, 'approved');
  await mkVideo(rich.id, HIDDEN_ITEM, 'submitted');

  const money = async (item, revenue) => {
    const { error } = await admin.from('tiktok_video_daily').insert({
      item_id: item,
      stat_date: '2026-08-10',
      advertiser_id: '7427187763989987329',
      cost: 10,
      gross_revenue: revenue,
      orders: 4,
      currency: 'USD',
    });
    if (error) throw new Error(`seed money: ${error.message}`);
  };
  // Deliberately enormous, so this creator lands at rank 1 on dev's real board
  // and the assertions below do not depend on who else happens to be on it.
  await money(RICH_ITEM, 999_999);
  await money(HIDDEN_ITEM, 500_000);
  ok('a creator with an approved earning video, and one with nothing');

  /* --------------------------------------------------- [1] the board reads */
  console.log('\n[1] A creator can read the board');

  const board = await rich.client.rpc('creator_leaderboard', {
    ...ALL,
    p_limit: 25,
    p_offset: 0,
    p_search: null,
  });
  check('the board loads for a signed-in creator', !board.error, board.error?.message);
  const rows = board.data ?? [];
  check('and it has rows on it', rows.length > 0, String(rows.length));

  const me = rows.find((r) => r.creator_id === rich.id);
  check('the earning creator is on it', Boolean(me));
  check('at rank 1, on the biggest GMV', me?.rank === 1, JSON.stringify(me?.rank));
  check('flagged as themselves', me?.is_me === true);
  check(
    'carrying ONLY the approved video, not the unapproved one',
    Number(me?.gmv) === 999_999,
    `saw ${me?.gmv}`
  );
  check('and counting it as one video', Number(me?.videos) === 1, String(me?.videos));

  check('the creator with no sales is absent', !rows.some((r) => r.creator_id === poor.id));

  /* ------------------------------------------- [2] what it must not carry -- */
  console.log('\n[2] What a row may never contain');

  const columns = Object.keys(rows[0] ?? {});
  for (const banned of ['email', 'brand_id', 'brand_name', 'budget', 'reward', 'tier', 'role']) {
    check(`no \`${banned}\` on a row`, !columns.some((c) => c.includes(banned)), columns.join(', '));
  }
  check(
    'the whole row is eleven known columns and nothing else',
    columns.length === 11,
    columns.join(', ')
  );

  /* ---------------------------------------------- [3] their own standing -- */
  console.log('\n[3] Where you stand, and only where YOU stand');

  const mine = await rich.client.rpc('my_leaderboard_standing', ALL);
  check('a creator can ask where they stand', !mine.error, mine.error?.message);
  check('and gets exactly one row', (mine.data ?? []).length === 1, String((mine.data ?? []).length));
  check('their own rank', mine.data?.[0]?.rank === 1);
  check('with a top percentage that is never zero', Number(mine.data?.[0]?.top_percent) >= 1);

  const none = await poor.client.rpc('my_leaderboard_standing', ALL);
  check(
    'somebody not on the board gets no row rather than a zero',
    !none.error && (none.data ?? []).length === 0,
    JSON.stringify(none.data ?? none.error)
  );

  /* --------------------------------------------------------- [4] attacks -- */
  console.log('\n[4] Attacks');

  {
    const { error } = await rich.client.rpc('leaderboard_totals', ALL);
    check('the private totals function is not exposed as an RPC', error !== null);
  }
  {
    // The search argument goes into an ilike. A creator who can smuggle a
    // pattern out of it could enumerate names one letter at a time, which is
    // still only names, but the point is that it is bounded to what the board
    // already shows.
    const { data, error } = await rich.client.rpc('creator_leaderboard', {
      ...ALL,
      p_limit: 100,
      p_offset: 0,
      p_search: "%' or '1'='1",
    });
    check('a quote in the search is data, not SQL', !error, error?.message);
    check('and it matches nobody', (data ?? []).length === 0, String((data ?? []).length));
  }
  {
    const { data } = await rich.client.rpc('creator_leaderboard', {
      ...ALL,
      p_limit: 100_000,
      p_offset: 0,
      p_search: null,
    });
    check('the page size is capped however big a limit is asked for', (data ?? []).length <= 100);
  }
  {
    const { data } = await rich.client.from('profiles').select('id, email').neq('id', rich.id);
    check(
      'a creator still cannot read another creator profile directly',
      (data ?? []).length === 0,
      `saw ${(data ?? []).length}`
    );
  }
  {
    const { data } = await rich.client.from('tiktok_video_daily').select('item_id').eq('item_id', HIDDEN_ITEM);
    check('and still cannot read their OWN unapproved video money', (data ?? []).length === 0);
  }

  /* ----------------------------------------------------- [5] signed out --- */
  console.log('\n[5] Signed out');
  const out = anon();
  {
    const { error } = await out.rpc('creator_leaderboard', { ...ALL, p_limit: 5, p_offset: 0, p_search: null });
    check('a stranger cannot read the board at all', error !== null);
  }
  {
    const { error } = await out.rpc('my_leaderboard_standing', ALL);
    check('nor ask where anybody stands', error !== null);
  }

  /* --------------------------------------------------------- [6] faces ---- */
  console.log('\n[6] The faces, which were admin only yesterday');
  {
    /*
     * THE AVATAR INDEX IS STAFF ONLY AGAIN, reversed on 2026-08-20. The policy
     * added the day before was `using (true)`, which let any signed-in account
     * read the whole table — and that table carries `handle`, for every
     * creator AND every applicant, including people who were turned down. A
     * directory of everybody who ever approached Wurx, for anybody who can sign
     * up.
     *
     * The board does not need it: `creator_leaderboard` is SECURITY DEFINER,
     * already decides who appears, and returns `avatar_path` as a column. The
     * client signs that path and never reads this table.
     */
    const { data } = await rich.client.from('creator_avatars').select('profile_id, handle');
    check(
      'a creator can NOT read the avatar index',
      (data ?? []).length === 0,
      `saw ${(data ?? []).length} rows`
    );

    // But the path from the board still signs, or the faces vanish.
    const board = await rich.client.rpc('creator_leaderboard', {
      ...ALL,
      p_limit: 25,
      p_offset: 0,
      p_search: null,
    });
    const path = (board.data ?? []).map((r) => r.avatar_path).filter(Boolean)[0];
    if (path) {
      const signed = await rich.client.storage.from('creator-avatars').createSignedUrls([path], 60);
      check(
        'but can still sign a path the BOARD gave them, which is what draws a face',
        !signed.error && Boolean(signed.data?.[0]?.signedUrl),
        signed.error?.message
      );
    } else {
      ok('no avatars on the board to sign, skipped');
    }
  }
  {
    const up = await rich.client.storage
      .from('creator-avatars')
      .upload(`${rich.id}.png`, new Blob([new Uint8Array([1, 2, 3])]), { upsert: true });
    check('but cannot write one', up.error !== null, JSON.stringify(up.data));
  }
  {
    const { data } = await rich.client.from('creator_avatars').delete().eq('profile_id', rich.id).select('profile_id');
    check('and cannot delete a row from the index', (data ?? []).length === 0);
  }

  /* ------------------------------------------------ [7] who may look at it */
  /*
   * A GRANT IS NOT A PERMISSION MODEL. Both functions were granted to
   * `authenticated`, which every signed-in account holds: an applicant nobody
   * has let in, an applicant who was REJECTED, and a creator who has been
   * suspended. All three could read every creator's GMV and ad spend by calling
   * the RPC. The gate is inside the function body now and reads the profiles
   * table, so a suspension bites on the next query rather than at the next
   * token refresh.
   */
  console.log('\n[7] Who is allowed to see the board at all');

  const asRole = async (tag, patch) => {
    const email = `board-${tag}-${STAMP}@wurxmediahub.test`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PW,
      email_confirm: true,
    });
    if (error) throw new Error(`could not create ${tag}: ${error.message}`);
    made.users.push(data.user.id);
    await admin.from('profiles').update(patch).eq('id', data.user.id);
    const client = anon();
    await client.auth.signInWithPassword({ email, password: PW });
    return client;
  };

  {
    const applicant = await asRole('applicant', { role: 'applicant', is_active: true });
    const { data, error } = await applicant.rpc('creator_leaderboard', {
      ...ALL,
      p_limit: 25,
      p_offset: 0,
      p_search: null,
    });
    check(
      'an applicant who has not been let in sees nothing',
      !error && (data ?? []).length === 0,
      JSON.stringify(data ?? error)
    );
    const mine = await applicant.rpc('my_leaderboard_standing', ALL);
    check('and cannot ask where they stand', (mine.data ?? []).length === 0);
    await applicant.auth.signOut();
  }
  {
    const suspended = await asRole('suspended', { role: 'creator', tier: 'creator', is_active: false });
    const { data } = await suspended.rpc('creator_leaderboard', {
      ...ALL,
      p_limit: 25,
      p_offset: 0,
      p_search: null,
    });
    check(
      'a SUSPENDED creator sees nothing, immediately rather than at the next token',
      (data ?? []).length === 0,
      `saw ${(data ?? []).length} rows`
    );
    await suspended.auth.signOut();
  }
  {
    // Staff must still see it, or the admin cannot check what a creator sees.
    const staff = await asRole('staff', { role: 'admin', is_active: true });
    const { data } = await staff.rpc('creator_leaderboard', {
      ...ALL,
      p_limit: 25,
      p_offset: 0,
      p_search: null,
    });
    check('but staff still can', (data ?? []).length > 0, `saw ${(data ?? []).length} rows`);
    await staff.auth.signOut();
  }

  /* ------------------------------------------- [8] one video, one creator -- */
  /*
   * Rashid, 2026-08-20: "each video has unique id and we need to be careful
   * because this is money sensitive". Nothing enforced it until now, so two
   * creators could each have the same link approved and each bank its GMV — on
   * their own screens AND on the board, where the totals are summed across
   * people and the same money would have counted twice.
   */
  console.log('\n[8] One video cannot belong to two creators');

  {
    const { error } = await admin.from('content_submissions').insert({
      application_id: made.application,
      creator_id: poor.id,
      brand_id: made.brand,
      offer_id: made.offer,
      video_url: `https://www.tiktok.com/@boardsuite/video/${RICH_ITEM}-stolen`,
      ad_code: `BOARD${STAMP}X`,
      ad_authorized: true,
      embed_id: RICH_ITEM,
      status: 'approved',
    });
    check(
      'a second creator cannot have the same video approved',
      error !== null,
      'it was allowed'
    );
    if (error) {
      check(
        'and the refusal names the creator who already has it',
        /already approved for/i.test(error.message),
        error.message
      );
    }
  }
  {
    // The same CREATOR filing one video against a job and a contest is legal,
    // and must stay legal: that is one person's video doing two jobs.
    const { error } = await admin.from('content_submissions').insert({
      application_id: made.application,
      creator_id: rich.id,
      brand_id: made.brand,
      offer_id: made.offer,
      video_url: `https://www.tiktok.com/@boardsuite/video/${RICH_ITEM}-again`,
      ad_code: `BOARD${STAMP}A`,
      ad_authorized: true,
      embed_id: RICH_ITEM,
      status: 'approved',
    });
    check('but the SAME creator filing it twice is still allowed', !error, error?.message);
  }
  {
    const { error } = await admin.from('content_submissions').insert({
      application_id: made.application,
      creator_id: poor.id,
      brand_id: made.brand,
      offer_id: made.offer,
      video_url: `https://www.tiktok.com/@boardsuite/video/${RICH_ITEM}-notyet`,
      ad_code: `BOARD${STAMP}P`,
      ad_authorized: true,
      embed_id: RICH_ITEM,
      status: 'submitted',
    });
    check(
      'and a second creator may still SUBMIT it, so the team decides rather than the clock',
      !error,
      error?.message
    );
  }
  {
    const bad = await admin.from('content_submissions').insert({
      application_id: made.application,
      creator_id: rich.id,
      brand_id: made.brand,
      offer_id: made.offer,
      video_url: 'https://www.tiktok.com/@boardsuite/video/nonsense',
      ad_code: `BOARD${STAMP}N`,
      ad_authorized: true,
      embed_id: 'not-an-id',
      status: 'submitted',
    });
    check('an embed_id that is not a number is refused by the column', bad.error !== null);
  }

  await rich.client.auth.signOut();
  await poor.client.auth.signOut();
} catch (err) {
  bad('the suite itself threw', String(err));
} finally {
  await cleanup();
  console.log('\ncleaned up');
}

console.log(`\n${'='.repeat(70)}`);
console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
