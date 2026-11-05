import { getSupabase } from '@/lib/supabase';

/* ════════════════════════════════════════════════════════════════════════
   WurxBase talks to OUR database now.

   It used to hold its own project URL and a publishable key as string
   literals, and reach a second Supabase project directly from the browser
   with no authentication at all — that key was the entire permission model,
   with every member's login stored in the clear behind it. On 2026-08-28
   Rashid consolidated: one app, one database, managed from one side. Their
   eight tables now live in the `wurxbase` SCHEMA of our own project, governed
   by RLS like everything else we own, and on 2026-08-29 the plaintext column
   was dropped — there is nothing here to log into any more.

   THERE IS EXACTLY ONE SUPABASE CLIENT IN THIS APPLICATION and it is not
   created here. `src/lib/supabase.ts` owns it, and CLAUDE.md calls that
   non-negotiable for a concrete reason: two clients race to refresh the same
   token, one loses, the token is revoked, and people get logged out at
   random. That is the exact bug this product is engineered against. So this
   file borrows the app's client rather than making another.

   WHY A SCHEMA RATHER THAN RENAMED TABLES. Their code says `.from('creators')`
   in forty-two places and `.from('app_users')` in twenty-four. Scoping the
   client to `wurxbase` means every one of those keeps working untouched, and
   their `creators` can never be confused with ours — theirs is a paid-deal
   tracker, ours is a person with a login. Same word, different grain.

   WHAT IS EXPOSED, and why it is a hand-written object rather than the client
   itself: `client.schema()` returns a PostgREST client scoped to the schema,
   which carries `from` and `rpc` but NOT `channel`. Their code uses exactly
   three members, so all three are given deliberately. Anything else they
   reach for should fail loudly here rather than silently escape the fence and
   query `public`.
   ════════════════════════════════════════════════════════════════════════ */

export const WURXBASE_SCHEMA = 'wurxbase';

/* Resolved lazily. `getSupabase()` reads validated env, and this module is
   imported by the lazy Paid Collabs chunk, so there is no import-time work. */
const db = () => getSupabase().schema(WURXBASE_SCHEMA);

/* ── APC viewers read VIEWS, not tables ────────────────────────────
   WURX-ADDED 2026-11-05. An APC viewer has no policy on any base table: the
   `wurxbase.creators` row carries WhatsApp, email, PayPal and Zelle, and row
   level security cannot hide a column. They get brand-scoped views instead
   (migration 20261105090100) and this map points the vendored code's
   `.from('creators')` at them, so none of its forty-five call sites change.

   THIS MAP IS A CONVENIENCE, NOT THE BOUNDARY. If it were wrong or bypassed,
   the APC would reach a base table and the database would answer with nothing.
   Tables not listed (app_users, audit_logs, join_requests, revoked_sessions,
   app_settings) are left alone ON PURPOSE: they come back empty for an APC. */
const APC_VIEWS = {
  creators: 'apc_creators',
  brand_monthly_budgets: 'apc_brand_monthly_budgets',
  activity_logs: 'apc_activity_logs',
};
let apcViewer = false;
export const setApcViewer = (on) => { apcViewer = Boolean(on); };
const tableFor = (table) => (apcViewer && APC_VIEWS[table]) || table;

export const supabase = {
  from: (table) => db().from(tableFor(table)),
  rpc: (fn, args, opts) => db().rpc(fn, args, opts),
  /* Realtime lives on the root client, not on the schema-scoped one. Their
     `postgres_changes` filters name the schema themselves and have all been
     pointed at `wurxbase`; a filter still saying `public` would subscribe to
     one of OUR tables and quietly deliver nothing. */
  channel: (...args) => getSupabase().channel(...args),
  removeChannel: (...args) => getSupabase().removeChannel(...args),
};

/* ── Reading a table that is bigger than 1000 rows ──────────────────
   PostgREST on this project enforces a HARD ceiling of 1000 rows per
   response (db-max-rows). It is not a client default and it cannot be
   raised from here: `.limit(5000)` still comes back with 1000 rows, and
   nothing in the response says the rest exist. A plain
   `select('*')` therefore looks like it worked while silently hiding
   every row past the first thousand.

   Anything that has to see the WHOLE table must walk it with .range().

   Pass a FACTORY, not a query: a supabase-js builder can only be awaited
   once, so each page needs a fresh one.

     const { data, error } = await selectAll(() =>
       supabase.from('creators').select('*').order('id'));

   Order matters. Paging is only stable when the sort is unique overall,
   so always end the ordering on a unique column (id). Sorting on a
   non-unique column alone lets rows shift between pages, which shows up
   as duplicated or missing records rather than as an error.

   Still true after the move: our project caps at 1000 as well. */
export const PAGE_SIZE = 1000;

export async function selectAll(build, pageSize = PAGE_SIZE) {
  const out = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1);
    if (error) return { data: null, error };
    const page = data || [];
    out.push(...page);
    if (page.length < pageSize) break;
    /* Runaway guard · a mis-built factory that ignores .range() would
       otherwise loop forever handing back the same full page. */
    if (out.length > 200000) break;
  }
  return { data: out, error: null };
}

/* ── The screens that call REST by hand ─────────────────────────────────
   Their database-health dot, the diagnostics panel and SQL Quest do not use
   the client at all: they built URLs against a hardcoded project and sent a
   hardcoded key. Both of those are now wrong, and wrong in the quietest
   possible way — they would have gone on querying the OLD project and
   reporting healthy numbers about a database nobody uses any more.

   Two extra things these need that the client handles invisibly:

     Accept-Profile / Content-Profile   tell PostgREST which schema to use.
                                        Without them a raw request lands in
                                        `public`, where none of these tables
                                        exist, and 404s.
     the session token                  RLS is on now. anon has no grants at
                                        all, so a request carrying only the
                                        publishable key gets nothing back.
   ───────────────────────────────────────────────────────────────────────── */

export const WURXBASE_ORIGIN = import.meta.env.VITE_SUPABASE_URL;

/* Shown in their diagnostics panel where the old project host used to be. */
export const WURXBASE_ENDPOINT_LABEL = `${String(WURXBASE_ORIGIN || '').replace(/^https?:\/\//, '')}/${WURXBASE_SCHEMA}`;

export async function wurxbaseHeaders(extra = {}) {
  const client = getSupabase();
  const { data } = await client.auth.getSession();
  const token = data?.session?.access_token;
  return {
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    /* Fall back to the publishable key so a signed-out call fails as a clean
       401 rather than as a malformed request nobody can read. */
    Authorization: `Bearer ${token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
    'Accept-Profile': WURXBASE_SCHEMA,
    'Content-Profile': WURXBASE_SCHEMA,
    ...extra,
  };
}

export async function wurxbaseRest(path, init = {}) {
  const headers = await wurxbaseHeaders(init.headers || {});
  return fetch(`${WURXBASE_ORIGIN}/rest/v1/${String(path).replace(/^\/+/, '')}`, { ...init, headers });
}

/* ── EUKA ───────────────────────────────────────────────────────────────
   Their app fetches every Euka figure from `/.netlify/functions/euka`, a
   serverless function that lived in the original developer's NETLIFY
   deployment. It was never inside the `src/` tree that was vendored in, and
   `vercel.json` deliberately lets that path 404 rather than answering it with
   index.html — so since the move, every one of those calls has failed.

   Nothing errored, because their code is written to degrade: each call site
   does `.then(r => r.ok ? r.json() : null)` and carries on. The store list
   came back null, so `eukaStoreForBrand` had nothing to match against and the
   brand screen said `No EUKA store named "Swisse"`; L30 GMV, tiers, brand
   photos, posted videos and the Discovery pool were all simply absent. That
   is the "our numbers are different from theirs" report, and it is one
   missing endpoint rather than a dozen separate bugs.

   The function is ported to `supabase/functions/euka`. This is the only thing
   that changed on their side: a fetch of a dead URL became a call through the
   one client, which attaches the session token so the function can check who
   is asking. Their key was a string literal in a committed file and their
   endpoint answered anybody; ours is a secret and staff-only, because
   `type=discovery` returns creator emails and phone numbers.

   Returns the parsed body, or NULL on any failure — deliberately the same
   contract their call sites already handle. */
/*
 * WHY THE LAST CALL FAILED, IN WORDS SOMEBODY CAN ACT ON.
 *
 * Returning null on every failure is the right contract — their call sites all
 * handle it — but it threw away the one thing worth keeping. Every possible
 * cause arrived at the same screen as `No EUKA store named "<brand>"`, which
 * names the brand and blames the data, when the real cause is usually nothing
 * to do with either.
 *
 * That cost real time: the message sent people looking at store names while a
 * profile-level problem sat one layer down, invisible because Rashid cannot
 * open a console and the failure only happens on somebody else's laptop.
 *
 * So the reason is kept here and the button says it out loud.
 */
let _eukaFailure = null;
export function lastEukaFailure() { return _eukaFailure; }

function describeEukaFailure(error) {
  /* supabase-js: FunctionsHttpError carries the Response, FunctionsFetchError
     means the request never got there at all. */
  const status = error && error.context && typeof error.context.status === 'number'
    ? error.context.status
    : null;
  if (status === null) {
    return {
      status: null,
      hint: 'the request never reached the server — a browser extension, VPN, firewall or offline connection is blocking it',
      fix: 'open this page in a private window with extensions off',
    };
  }
  if (status === 401) {
    return { status, hint: 'this browser is signed in but the server rejected the session', fix: 'sign out and sign in again' };
  }
  if (status === 403) {
    return { status, hint: 'this account is not allowed to use EUKA', fix: 'check the role on this account' };
  }
  if (status === 404) {
    return { status, hint: 'the EUKA function is not deployed on this project', fix: 'redeploy the euka function' };
  }
  if (status === 500) {
    return { status, hint: 'the EUKA function is misconfigured — most likely its API key secret is missing', fix: 'set EUKA_API_KEY on the function' };
  }
  if (status === 502) {
    return { status, hint: 'EUKA itself is down or refused us', fix: 'wait a moment and press it again' };
  }
  return { status, hint: 'the EUKA function answered ' + status, fix: 'wait a moment and press it again' };
}

export async function eukaJson(params = {}) {
  try {
    const body = {};
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') body[k] = String(v);
    }
    const { data, error } = await getSupabase().functions.invoke('euka', { body });
    if (error) {
      _eukaFailure = describeEukaFailure(error);
      console.error('[euka]', _eukaFailure.status, _eukaFailure.hint, error.message || error);
      return null;
    }
    /* The function answers 502 with `{error}` when EUKA itself fails. Treat
       that as a failure rather than handing back an object whose every
       expected key is missing — a caller reading `.stores` off it would see
       undefined and report "no stores" instead of "EUKA is down". */
    if (data && data.error) {
      _eukaFailure = { status: 200, hint: String(data.error), fix: 'this came back from the server, not from the browser' };
      console.error('[euka]', data.error);
      return null;
    }
    _eukaFailure = null;
    return data || null;
  } catch (e) {
    _eukaFailure = {
      status: null,
      hint: 'the request never reached the server — a browser extension, VPN, firewall or offline connection is blocking it',
      fix: 'open this page in a private window with extensions off',
    };
    console.error('[euka]', e && e.message);
    return null;
  }
}

/* WURX-ADDED · a brand's products, from whichever platform sells it.
   Rashid, 2026-09-23: onboarding should offer a product dropdown rather than a
   free-text box. `collab-products` decides between Euka and Reacher and answers
   one shape, so this helper — and the modal above it — never has to know which.

   NULL MEANS "COULD NOT ASK", not "no products". The modal keeps its typed
   fallback in that case rather than showing an empty dropdown, which would read
   as "this brand has none". */
export async function collabProducts(brand) {
  const name = String(brand || '').trim();
  if (!name) return null;
  try {
    const { data, error } = await getSupabase().functions.invoke('collab-products', { body: { brand: name } });
    if (error) {
      console.error('[collab-products]', error.message || error);
      return null;
    }
    if (!data || data.error) {
      if (data && data.error) console.error('[collab-products]', data.error);
      return null;
    }
    return {
      source: String(data.source || 'none'),
      store: data.store || '',
      note: data.note || '',
      products: Array.isArray(data.products) ? data.products : [],
    };
  } catch (e) {
    console.error('[collab-products]', e && e.message);
    return null;
  }
}

/* WURX-ADDED · which platform a brand's figures come from, without fetching its
   catalogue. The brand page asks on every open, only to label its own button.
   Returns 'euka', 'reacher' or 'none'; null means the question could not be
   asked, which is not the same as "neither". */
export async function brandSource(brand) {
  const name = String(brand || '').trim();
  if (!name) return null;
  try {
    const { data, error } = await getSupabase().functions.invoke('collab-products', { body: { brand: name, probe: true } });
    if (error || !data || data.error) return null;
    return { source: String(data.source || 'none'), store: data.store || '' };
  } catch {
    return null;
  }
}

/* WURX-ADDED · the Reacher videos that are on no roster row (public table,
   so the root client, not the wurxbase-scoped one). Never throws: a screen that
   cannot read it simply shows nothing extra. */
export async function fetchReacherUnrostered() {
  try {
    const { data, error } = await selectAll(() =>
      getSupabase().from('reacher_unrostered_videos')
        .select('handle, video_url, posted_date, views, gmv, units, product')
        .order('gmv', { ascending: false }));
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

/* WURX-ADDED · run the Reacher sync for Irwin Naturals from the screen, the way
   the EUKA videos button runs Euka's. Staff only, checked inside the function. */
export async function runReacherSync() {
  try {
    const { data, error } = await getSupabase().functions.invoke('reacher-sync', { body: {} });
    if (error) return { ok: false, message: error.message || 'Reacher sync failed' };
    if (!data || data.error) return { ok: false, message: (data && data.error) || 'Reacher sync failed' };
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, message: (e && e.message) || 'Reacher sync failed' };
  }
}
