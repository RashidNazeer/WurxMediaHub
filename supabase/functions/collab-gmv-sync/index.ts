/**
 * collab-gmv-sync
 * ---------------------------------------------------------------------------
 * What a creator made for a brand in a calendar month, copied from Euka or Reacher
 * into `collab_creator_month_gmv`, for the Brand GMV column of the Creators and
 * Brands tables.
 *
 * Rashid, 2026-11-06: set the date to September and see the GMV the creator made
 * from 1 to 30 September. Sales by SALES date, from any of her videos. Our own video
 * figures cannot say that (one overwritten running total per video), but both
 * platforms keep daily sales:
 *
 *   Euka     POST /api/v1/dashboard/top-creators-by-gmv   top 50 per brand
 *   Reacher  POST /public/v1/creators/performance         every creator, paged
 *
 * A BRAND IS READ FROM EUKA WHEN EUKA HAS IT, OTHERWISE FROM REACHER, NEVER BOTH:
 * adding the two would count a sale twice. A brand on neither is skipped and named
 * in the answer, and the screen shows a dash for it.
 *
 * EVERY RUN DOES ONLY WHAT IS MISSING OR STALE, so most runs do nothing and a fresh
 * install fills the last six months a few brands at a time, inside the time budget.
 * The current month is re-read every 6 hours, last month every 12 for the week it
 * takes to settle (TikTok attributes some sales late), older months once.
 *
 * READ ONLY AGAINST BOTH PLATFORMS. Reacher goes through `_shared/reacher.ts`, which
 * refuses any path not on its read allow-list. Euka is a POST of a filter, not a write.
 * The only thing written is our own two tables.
 *
 * WHO CAN RUN IT: the scheduler presenting `x-sync-secret`, or an active ops/admin/
 * ads_manager for a manual kick. Same gate as reacher-sync and euka-ads-sync.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import { EUKA_V0, EUKA_V1, eukaKeys, type EukaAuth } from '../_shared/euka-accounts.ts';
import { read as reacherRead, reacherKey, shops as reacherShops } from '../_shared/reacher.ts';
import {
  EUKA_CAP,
  fromEuka,
  fromReacher,
  matchBrand,
  monthOf,
  monthWindow,
  needsRead,
  rangeWindow,
  recentMonths,
  type CreatorGmv,
  type Platform,
} from '../_shared/collab-gmv.ts';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const Body = z.object({
  /** Months to read, `YYYY-MM`. Default: the last six, including this one. */
  months: z.array(z.string().regex(MONTH)).max(36).optional(),
  /** Only these brands (as named in Paid Collabs). Default: every brand there. */
  brands: z.array(z.string().min(1).max(120)).max(100).optional(),
  /** Read even what is fresh. */
  force: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  /**
   * ANY range of days, answered live and NOT stored: every owned brand is asked once for
   * those dates and the figures come straight back. This is the one thing a Paid Collabs
   * reader (not only staff) may ask, because it only reads.
   */
  range: z.object({ from: z.string(), to: z.string() }).optional(),
  budgetMs: z.number().int().min(5_000).max(140_000).optional(),
});

type Db = SupabaseClient;

const MONTHS_BACK = 14; // the Performance sheet reaches back about a year
const REACHER_MAX_PAGES = 60; // 6,000 creators for one brand-month is far past anything real

/** Euka's brands, by name, each with the account (key) that owns it. First key wins a name. */
async function eukaBrands(): Promise<{ name: string; id: string; auth: EukaAuth }[]> {
  const out: { name: string; id: string; auth: EukaAuth }[] = [];
  const seen = new Set<string>();
  for (const k of eukaKeys()) {
    const auth: EukaAuth = { Authorization: `Bearer ${k}` };
    try {
      const r = await fetch(`${EUKA_V0}/brands`, { headers: auth, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) continue;
      const list = await r.json();
      for (const b of Array.isArray(list) ? list : []) {
        const id = String(b?.id ?? '').trim();
        const name = String(b?.name ?? '').trim();
        if (!id || !name || seen.has(id)) continue;
        seen.add(id);
        out.push({ name, id, auth });
      }
    } catch {
      /* an account that does not answer is skipped; its brands show as unmapped */
    }
  }
  return out;
}

async function readEuka(brand: { id: string; auth: EukaAuth }, start: string, end: string) {
  const r = await fetch(`${EUKA_V1}/dashboard/top-creators-by-gmv`, {
    method: 'POST',
    headers: { ...brand.auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      brandId: brand.id,
      postedDateRange: { startDate: start, endDate: end },
      compareTo: { type: 'none' },
      limit: EUKA_CAP,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!r.ok) throw new Error(`euka ${r.status} ${(await r.text()).slice(0, 160)}`);
  return fromEuka(await r.json());
}

async function readReacher(shopId: number, start: string, end: string) {
  const pages: unknown[] = [];
  for (let page = 1; page <= REACHER_MAX_PAGES; page++) {
    const j = await reacherRead('/creators/performance', shopId, {
      page,
      page_size: 100,
      start_date: start,
      end_date: end,
      sort_by: 'gmv',
    });
    pages.push(j);
    const total = Number((j as { pagination?: { total_pages?: number } }).pagination?.total_pages ?? 1);
    if (page >= total) break;
    /* sorted by GMV, so once a page ends at zero the rest are zeros too */
    const data = (j as { data?: { gmv?: number }[] }).data ?? [];
    if (data.length && !(Number(data[data.length - 1]?.gmv) > 0)) break;
  }
  return fromReacher(pages);
}

async function save(
  db: Db,
  month: string,
  brand: string,
  source: Platform,
  got: { rows: CreatorGmv[]; truncated: boolean; floor: number | null },
) {
  const t0 = new Date().toISOString();
  const meta = await db.from('collab_brand_month_gmv').upsert({
    month, brand, source, creators: got.rows.length, truncated: got.truncated, floor_gmv: got.floor, fetched_at: t0,
  }, { onConflict: 'month,brand' });
  if (meta.error) throw new Error(meta.error.message);

  for (let i = 0; i < got.rows.length; i += 500) {
    const chunk = got.rows.slice(i, i + 500).map((r) => ({
      month, brand, handle: r.handle, gmv: r.gmv, source, fetched_at: t0,
    }));
    const { error } = await db.from('collab_creator_month_gmv').upsert(chunk, { onConflict: 'month,brand,handle' });
    if (error) throw new Error(error.message);
  }
  /* creators the platform no longer lists for that month (a correction) */
  const del = await db.from('collab_creator_month_gmv').delete().eq('month', month).eq('brand', brand).lt('fetched_at', t0);
  if (del.error) throw new Error(del.error.message);
}

type Owner = { source: Platform; euka?: { id: string; auth: EukaAuth }; shopId?: number };

/** Which platform owns each brand: Euka first, then Reacher, otherwise neither. */
async function loadOwners(brands: string[]): Promise<{ owner: Map<string, Owner>; unmapped: string[] }> {
  const euka = eukaKeys().length ? await eukaBrands() : [];
  const rshops = reacherKey() ? (await reacherShops()).map((s) => ({ name: s.shop_name, id: s.shop_id })) : [];
  const owner = new Map<string, Owner>();
  const unmapped: string[] = [];
  for (const b of brands) {
    const e = matchBrand(b, euka);
    if (e) { owner.set(b, { source: 'euka', euka: e }); continue; }
    const r = matchBrand(b, rshops);
    if (r) { owner.set(b, { source: 'reacher', shopId: r.id }); continue; }
    unmapped.push(b);
  }
  return { owner, unmapped };
}

async function readBrand(o: Owner, start: string, end: string) {
  return o.source === 'euka' ? await readEuka(o.euka!, start, end) : await readReacher(o.shopId!, start, end);
}

/** Run `fn` over `items`, at most `n` at a time (Reacher allows 60 calls a minute). */
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  }));
  return out;
}

/* A range somebody asked for is answered once and remembered for ten minutes, so a team
   looking at the same dates does not spend a call per brand per screen. */
const RANGE_TTL = 10 * 60_000;
const rangeCache = new Map<string, { at: number; body: unknown }>();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, req);
  const started = Date.now();

  const db: Db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    /* an empty body is a scheduled run */
  }
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) return json({ error: 'Bad request' }, 400, req);
  const { force, dryRun, range } = parsed.data;
  const deadline = started + (parsed.data.budgetMs ?? 100_000);

  /* ── who is asking: the scheduler's secret (timing-safe), active staff, or, for a
        range question only, any Paid Collabs reader ── */
  const secret = Deno.env.get('COLLAB_GMV_SYNC_SECRET') ?? '';
  const presented = req.headers.get('x-sync-secret') ?? '';
  let isCron = false;
  if (secret && presented) {
    const a = new TextEncoder().encode(presented);
    const b = new TextEncoder().encode(secret);
    if (a.length === b.length) {
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
      isCron = diff === 0;
    }
  }
  if (!isCron) {
    const auth = req.headers.get('Authorization') ?? '';
    const token = auth.replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Not allowed' }, 401, req);
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: 'Not allowed' }, 401, req);
    const { data: profile } = await db.from('profiles').select('role, is_active').eq('id', who.user.id).single();
    const staff = !!profile?.is_active && ['ops', 'admin', 'ads_manager'].includes(profile.role);
    if (!staff) {
      /* a reader may only ask a range question, which writes nothing */
      if (!range) return json({ error: 'Not allowed' }, 403, req);
      const asUser = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: auth } } },
      );
      const { data: viewer } = await asUser.rpc('is_collabs_viewer');
      if (viewer !== true) return json({ error: 'Not allowed' }, 403, req);
    }
  }

  if (eukaKeys().length === 0 && !reacherKey()) {
    return json({ error: 'Neither a EUKA key nor REACHER_API_KEY is set on this project' }, 500, req);
  }

  try {
    const now = new Date();
    const months = parsed.data.months ?? recentMonths(now, MONTHS_BACK);

    /* our brands, as Paid Collabs names them */
    const names = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.schema('wurxbase').from('creators').select('brand').range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const r of data ?? []) {
        const b = String((r as { brand?: unknown }).brand ?? '').trim();
        if (b) names.add(b);
      }
      if (!data || data.length < 1000) break;
    }
    const wanted = parsed.data.brands ? new Set(parsed.data.brands.map((b) => b.trim())) : null;
    const brands = [...names].filter((b) => !wanted || wanted.has(b)).sort();

    const { owner, unmapped } = await loadOwners(brands);

    /* ── a range somebody picked: ask live, store nothing ── */
    if (range) {
      const w = rangeWindow(range.from, range.to, now);
      if (!w) return json({ error: 'Pick two real days, the start not after the end, within a year' }, 400, req);
      const key = `${w.start}|${w.end}`;
      const hit = rangeCache.get(key);
      if (hit && Date.now() - hit.at < RANGE_TTL) return json(hit.body, 200, req);
      const failedR: { brand: string; error: string }[] = [];
      const got = await pool([...owner.entries()], 4, async ([brand, o]) => {
        try {
          const g = await readBrand(o, w.start, w.end);
          return { brand, source: o.source, truncated: g.truncated, floor: g.floor, rows: g.rows };
        } catch (e) {
          failedR.push({ brand, error: String((e as Error).message).slice(0, 160) });
          return null;
        }
      });
      const body = { range: w, brands: got.filter(Boolean), unmapped, failed: failedR };
      /* only a complete answer is remembered: a half answer must not outlive the outage */
      if (!failedR.length) {
        if (rangeCache.size > 40) rangeCache.clear();
        rangeCache.set(key, { at: Date.now(), body });
      }
      return json(body, 200, req);
    }

    /* what has been read, and when */
    const { data: have, error: haveErr } = await db
      .from('collab_brand_month_gmv')
      .select('month, brand, fetched_at')
      .in('month', months);
    if (haveErr) throw new Error(haveErr.message);
    const fetched = new Map<string, Date>();
    for (const h of have ?? []) fetched.set(`${h.month}\u0000${h.brand}`, new Date(h.fetched_at));

    /* newest month first, so a fresh install fills this month before last year */
    const units: { month: string; brand: string }[] = [];
    for (const m of [...months].sort().reverse()) {
      for (const b of owner.keys()) {
        if (force || needsRead(m, fetched.get(`${m}\u0000${b}`) ?? null, now)) units.push({ month: m, brand: b });
      }
    }

    const done: { month: string; brand: string; source: Platform; creators: number; truncated: boolean }[] = [];
    const failed: { month: string; brand: string; error: string }[] = [];
    let pending = 0;
    for (const u of units) {
      if (Date.now() > deadline) { pending++; continue; }
      const o = owner.get(u.brand)!;
      const { start, end } = monthWindow(u.month, now);
      if (start > end) continue; // a month that has not started
      try {
        const got = await readBrand(o, start, end);
        if (!dryRun) await save(db, u.month, u.brand, o.source, got);
        done.push({ month: u.month, brand: u.brand, source: o.source, creators: got.rows.length, truncated: got.truncated });
      } catch (e) {
        failed.push({ month: u.month, brand: u.brand, error: String((e as Error).message).slice(0, 200) });
      }
    }

    return json({
      dryRun: dryRun === true,
      thisMonth: monthOf(now),
      months,
      brands: brands.length,
      unmapped,
      due: units.length,
      read: done.length,
      pending,
      failed,
      done,
      ms: Date.now() - started,
    }, 200, req);
  } catch (e) {
    return json({ error: String((e as Error).message).slice(0, 300) }, 502, req);
  }
});
