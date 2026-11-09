/**
 * collab-video-hits-sync
 * ---------------------------------------------------------------------------
 * Each Paid Collabs video's GMV for the last 30 and 90 days, and its lifetime views, from
 * Euka or Reacher, into `collab_video_metrics`. That table feeds the creator Hit Rate (a
 * video is a hit under the criteria the user chooses; the rule lives in SQL, in
 * `collab_video_hit_reasons`, and nothing here decides what a hit is).
 *
 * WHY THESE SOURCES. The rows in `wurxbase.creators.video_codes` hold one overwritten lifetime
 * `revenue` per video, which cannot answer "GMV in the last 30 days". Two platforms can:
 *
 *   EUKA     `POST /api/v1/videos/search`, scope `commerceWindow` (the sales a video earned
 *            inside a date range, whenever it was posted) and scope `lifetime` (lifetime views),
 *            for up to 100 explicit TikTok video ids per call. Three calls a batch.
 *   REACHER  `POST /videos/performance` (GMV and views EARNED INSIDE a date range) and
 *            `POST /videos/list` (lifetime totals), asked per creator handle. Reacher cannot be
 *            asked for a list of video ids, so each creator on the brand is read in turn and
 *            our videos are picked out of the answer by TikTok id.
 *
 * A BRAND IS READ FROM EUKA WHEN EUKA HAS IT, OTHERWISE FROM REACHER, NEVER BOTH. A brand on
 * neither is skipped and named in the answer (`unmapped`); its videos stay unverified for GMV.
 * (Cruva brands cannot be read from here: Cruva's data endpoints need an interactive login that
 * a scheduled function does not have, so their rows are loaded from outside and carry
 * `source = 'cruva'`. This function never touches a brand it cannot map.)
 *
 * WHAT A MISSING ANSWER MEANS (and this is the rule that keeps hit rates honest):
 *   - If the platform's LIFETIME list does not contain the video, it is recorded `known = false`
 *     and every figure stays NULL: unverified, never zero, never a hit.
 *   - If the lifetime list DOES contain it but a window omits it, the video had no sales in that
 *     window: stored as 0 (an observed zero), unless that window's answer was cut short, in
 *     which case the figure is unknown (NULL).
 *   - A window figure in a currency other than USD is not compared with a dollar threshold: it
 *     is stored NULL (unverified) and counted in `nonUsd`.
 *
 * BOTH WINDOWS END ON THE SAME DAY and are written in one upsert, so a video's 30 and 90 day
 * figures never come from different dates. `window_end` is that day.
 *
 * READ ONLY AGAINST BOTH PLATFORMS (a POST of a filter). Reacher goes through
 * `_shared/reacher.ts`, which refuses any path not on its read allow-list. The only thing
 * written is our own table.
 * WHO CAN RUN IT: the scheduler presenting `x-sync-secret` (same secret as the other collab
 * syncs), or an active ops/admin/ads_manager for a manual kick.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import { EUKA_V0, EUKA_V1, eukaKeys, type EukaAuth } from '../_shared/euka-accounts.ts';
import { matchBrand } from '../_shared/collab-gmv.ts';
import { read as reacherRead, reacherKey, shops as reacherShops, videoId as reacherVideoId } from '../_shared/reacher.ts';

const Body = z.object({
  /** Only these Paid Collabs brands. Default: every brand that has videos. */
  brands: z.array(z.string().min(1).max(120)).max(100).optional(),
  /** Read even what is fresh. */
  force: z.boolean().optional(),
  /** Read the platforms and report, write nothing; returns a sample of what it would store. */
  dryRun: z.boolean().optional(),
  /** Only these TikTok video ids (debugging). */
  ids: z.array(z.string().regex(/^\d+$/)).max(200).optional(),
  budgetMs: z.number().int().min(5_000).max(140_000).optional(),
});

type Db = SupabaseClient;

const BATCH = 100; // Euka's cap on explicit video ids per call
const PAGES_MAX = 3; // a 100-id read is one page; this only guards a surprise
const FRESH_HOURS = 20; // known videos are re-read once their window has moved
const UNKNOWN_DAYS = 3; // a video the platform did not hold is asked about again after this long
const CONCURRENCY = 3;
const R_PAGES = 5; // Reacher: up to 500 videos per creator per list before we call the answer cut short
const R_GAP_MS = 700; // Reacher allows about 60 reads a minute; stay well under it

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

type Source = 'euka' | 'reacher';
type Row = {
  item_id: string;
  known: boolean;
  gmv_30d: number | null;
  gmv_90d: number | null;
  views: number | null;
  lifetime_gmv: number | null;
  window_end: string;
  source_through: string | null;
  source: Source;
  fetched_at: string;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/* ───────────────────────────────────── Euka ───────────────────────────────────── */

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
      /* an account that does not answer is skipped; its brands read as unmapped */
    }
  }
  return out;
}

type Money = { amount?: number; currencyCode?: string | null } | null | undefined;
type Perf = {
  scope?: string;
  sourceThroughDate?: string | null;
  attributedGmv?: Money;
  commerce?: { attributedGmv?: Money };
  views?: number | null;
};
type Item = { videoId?: string; performance?: Perf | null };

/** One /videos/search read of explicit ids, every page. Throws on a non-200. */
async function search(
  brand: { id: string; auth: EukaAuth },
  scope: Record<string, unknown>,
): Promise<Item[]> {
  const out: Item[] = [];
  for (let page = 1; page <= PAGES_MAX; page++) {
    const r = await fetch(`${EUKA_V1}/videos/search`, {
      method: 'POST',
      headers: { ...brand.auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ brandId: brand.id, scope, page, pageSize: BATCH }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) throw new Error(`euka videos/search ${r.status} ${(await r.text()).slice(0, 160)}`);
    const j = (await r.json()) as { items?: Item[]; pageInfo?: { hasNextPage?: boolean } };
    out.push(...(Array.isArray(j.items) ? j.items : []));
    if (!j.pageInfo?.hasNextPage) break;
  }
  return out;
}

const byId = (items: Item[]) => new Map(items.map((i) => [String(i.videoId ?? ''), i.performance ?? null]));

/**
 * A window's GMV for a video Euka holds.
 *   - the window did not list the video at all (`undefined`): it had no sales in it, an
 *     observed zero;
 *   - the window listed it but gave no readable figure, or a figure in another currency:
 *     NULL, unverified. A response shape this code does not understand must never become a
 *     confident zero, because zero means "checked, not a hit".
 */
function windowGmv(p: Perf | null | undefined): { v: number | null; nonUsd: boolean } {
  if (p === undefined) return { v: 0, nonUsd: false };
  const m = p?.commerce?.attributedGmv;
  if (!m || typeof m.amount !== 'number' || !Number.isFinite(m.amount)) return { v: null, nonUsd: false };
  if (m.currencyCode && m.currencyCode.toUpperCase() !== 'USD') return { v: null, nonUsd: true };
  return { v: round2(m.amount), nonUsd: false };
}

/** Read one Euka batch (<= 100 ids of one brand) and turn it into rows. */
async function readEukaBatch(brand: { id: string; auth: EukaAuth }, ids: string[], end: string) {
  const filter = { videoIds: ids };
  const [life, w30, w90] = await Promise.all([
    search(brand, { kind: 'lifetime', filter }),
    search(brand, { kind: 'commerceWindow', dateRange: { startDate: addDays(end, -29), endDate: end }, filter }),
    search(brand, { kind: 'commerceWindow', dateRange: { startDate: addDays(end, -89), endDate: end }, filter }),
  ]);
  const L = byId(life), A = byId(w30), B = byId(w90);
  const now = new Date().toISOString();
  let nonUsd = 0;
  const rows: Row[] = ids.map((id) => {
    if (!L.has(id)) {
      return { item_id: id, known: false, gmv_30d: null, gmv_90d: null, views: null, lifetime_gmv: null, window_end: end, source_through: null, source: 'euka', fetched_at: now };
    }
    const lp = L.get(id);
    const a = windowGmv(A.get(id));
    const b = windowGmv(B.get(id));
    if (a.nonUsd || b.nonUsd) nonUsd++;
    const lt = lp?.attributedGmv;
    const views = typeof lp?.views === 'number' && lp.views >= 0 ? Math.round(lp.views) : null;
    return {
      item_id: id,
      known: true,
      gmv_30d: a.v,
      gmv_90d: b.v,
      views,
      lifetime_gmv: lt && typeof lt.amount === 'number' ? round2(lt.amount) : null,
      window_end: end,
      source_through: B.get(id)?.sourceThroughDate ?? A.get(id)?.sourceThroughDate ?? null,
      source: 'euka',
      fetched_at: now,
    };
  });
  return { rows, nonUsd };
}

/* ─────────────────────────────────── Reacher ─────────────────────────────────── */

type RVideo = { video_id?: string; tiktok_url?: string; video_url?: string; video_gmv?: number | null; views?: number | null };

const rId = (v: RVideo): string | null => {
  const raw = String(v.video_id ?? '').trim();
  return /^\d+$/.test(raw) ? raw : reacherVideoId(v.tiktok_url ?? v.video_url);
};

/** Every page of one Reacher read (max R_PAGES). `truncated` = the answer was cut short. */
async function rPaged(
  shopId: number,
  path: string,
  body: Record<string, unknown>,
  until: number,
): Promise<{ rows: RVideo[]; currency: string | null; truncated: boolean }> {
  const rows: RVideo[] = [];
  let currency: string | null = null;
  for (let page = 1; page <= R_PAGES; page++) {
    if (Date.now() > until) return { rows, currency, truncated: true };
    const j = await reacherRead(path, shopId, { ...body, page, page_size: 100 });
    rows.push(...((Array.isArray(j.data) ? j.data : []) as RVideo[]));
    if (typeof j.currency === 'string') currency = j.currency;
    const pages = Number(((j.pagination ?? {}) as { total_pages?: number }).total_pages);
    await sleep(R_GAP_MS);
    if (!Number.isFinite(pages) || pages < 1 || page >= pages) return { rows, currency, truncated: false };
  }
  return { rows, currency, truncated: true };
}

type RWindow = Map<string, number | null>;
const rIndex = (rows: RVideo[]): RWindow => {
  const m: RWindow = new Map();
  for (const v of rows) {
    const id = rId(v);
    if (!id) continue;
    const g = typeof v.video_gmv === 'number' && Number.isFinite(v.video_gmv) ? v.video_gmv : null;
    m.set(id, g);
  }
  return m;
};

/** One window's GMV for a video the lifetime list contains (same rule as Euka's). */
function rWindowGmv(w: RWindow, truncated: boolean, currency: string | null, id: string): { v: number | null; nonUsd: boolean } {
  if (currency && currency.toUpperCase() !== 'USD') return { v: null, nonUsd: true };
  if (!w.has(id)) return { v: truncated ? null : 0, nonUsd: false };
  const g = w.get(id);
  return { v: g === null || g === undefined ? null : round2(g), nonUsd: false };
}

/**
 * Read one creator's videos on one Reacher shop and turn OUR ids into rows. An id the lifetime
 * list does not contain is `known = false`, except when that list was cut short, in which case
 * nothing is recorded for it (we cannot say it is absent).
 */
async function readReacherHandle(shopId: number, handle: string, ids: string[], end: string, until: number) {
  const life = await rPaged(shopId, '/videos/list', { creator_handle: handle, sort_by: 'video_gmv', sort_dir: 'desc' }, until);
  const p30 = await rPaged(shopId, '/videos/performance', { creator_handle: handle, start_date: addDays(end, -29), end_date: end, sort_by: 'video_gmv', sort_dir: 'desc' }, until);
  const p90 = await rPaged(shopId, '/videos/performance', { creator_handle: handle, start_date: addDays(end, -89), end_date: end, sort_by: 'video_gmv', sort_dir: 'desc' }, until);
  const L = new Map<string, RVideo>();
  for (const v of life.rows) {
    const id = rId(v);
    if (id) L.set(id, v);
  }
  const W30 = rIndex(p30.rows), W90 = rIndex(p90.rows);
  const now = new Date().toISOString();
  let nonUsd = 0, truncated = 0;
  const rows: Row[] = [];
  for (const id of ids) {
    const v = L.get(id);
    if (!v) {
      if (life.truncated) { truncated++; continue; }
      rows.push({ item_id: id, known: false, gmv_30d: null, gmv_90d: null, views: null, lifetime_gmv: null, window_end: end, source_through: null, source: 'reacher', fetched_at: now });
      continue;
    }
    const a = rWindowGmv(W30, p30.truncated, p30.currency, id);
    const b = rWindowGmv(W90, p90.truncated, p90.currency, id);
    if (a.nonUsd || b.nonUsd) nonUsd++;
    rows.push({
      item_id: id,
      known: true,
      gmv_30d: a.v,
      gmv_90d: b.v,
      views: typeof v.views === 'number' && v.views >= 0 ? Math.round(v.views) : null,
      lifetime_gmv: typeof v.video_gmv === 'number' && Number.isFinite(v.video_gmv) ? round2(v.video_gmv) : null,
      window_end: end,
      source_through: null,
      source: 'reacher',
      fetched_at: now,
    });
  }
  return { rows, nonUsd, truncated };
}

/* ─────────────────────────────────── shared ─────────────────────────────────── */

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

const cleanHandle = (h: unknown) => String(h ?? '').trim().replace(/^@+/, '').toLowerCase();

/**
 * Each Paid Collabs brand's distinct TikTok video ids, from the creators' video rows, with the
 * handle that posted each (read from the link, which is exact; the row's own account is the
 * fallback).
 */
async function loadVideos(db: Db): Promise<Map<string, Map<string, string>>> {
  const out = new Map<string, Map<string, string>>();
  for (let from = 0; ; from += 500) {
    const { data, error } = await db
      .schema('wurxbase')
      .from('creators')
      .select('brand, tiktok_account, video_codes')
      .order('id')
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as { brand?: string; tiktok_account?: string; video_codes?: { video?: string }[] | null }[]) {
      const brand = String(c.brand ?? '').trim();
      if (!brand) continue;
      for (const v of Array.isArray(c.video_codes) ? c.video_codes : []) {
        const url = String(v?.video ?? '');
        const m = /\/video\/(\d+)/.exec(url);
        if (!m) continue;
        const handle = cleanHandle(/tiktok\.com\/@([^/?#]+)/i.exec(url)?.[1] ?? c.tiktok_account);
        let s = out.get(brand);
        if (!s) out.set(brand, (s = new Map()));
        if (!s.has(m[1]!) || (!s.get(m[1]!) && handle)) s.set(m[1]!, handle);
      }
    }
    if (!data || data.length < 500) break;
  }
  return out;
}

async function loadStored(db: Db): Promise<Map<string, { known: boolean; at: number }>> {
  const out = new Map<string, { known: boolean; at: number }>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('collab_video_metrics').select('item_id, known, fetched_at').order('item_id').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) out.set(String(r.item_id), { known: !!r.known, at: new Date(r.fetched_at as string).getTime() });
    if (!data || data.length < 1000) break;
  }
  return out;
}

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
  const { force, dryRun, ids: onlyIds } = parsed.data;
  const deadline = started + (parsed.data.budgetMs ?? 100_000);

  /* ── who is asking: the scheduler's secret (timing-safe) or active staff ── */
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
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Not allowed' }, 401, req);
    const { data: who } = await db.auth.getUser(token);
    if (!who?.user) return json({ error: 'Not allowed' }, 401, req);
    const { data: profile } = await db.from('profiles').select('role, is_active').eq('id', who.user.id).single();
    if (!profile?.is_active || !['ops', 'admin', 'ads_manager'].includes(profile.role)) {
      return json({ error: 'Not allowed' }, 403, req);
    }
  }

  try {
    const hasEuka = eukaKeys().length > 0;
    const hasReacher = !!reacherKey();
    if (!hasEuka && !hasReacher) return json({ error: 'No Euka or Reacher key is configured' }, 503, req);
    const euka = hasEuka ? await eukaBrands() : [];
    const rshops = hasReacher ? (await reacherShops()).map((s) => ({ name: s.shop_name, id: s.shop_id })) : [];
    const videos = await loadVideos(db);
    const stored = await loadStored(db);
    const today = isoDay(new Date());
    const staleKnown = Date.now() - FRESH_HOURS * 3_600_000;
    const staleUnknown = Date.now() - UNKNOWN_DAYS * 86_400_000;

    const wanted = parsed.data.brands ? new Set(parsed.data.brands.map((b) => b.trim())) : null;
    const unmapped: string[] = [];
    const reacherBrands: string[] = [];
    const claimed = new Set<string>(); // a video under two brands is asked about once, under the first that owns it
    type EukaWork = { brandName: string; brand: { id: string; auth: EukaAuth }; ids: string[] };
    type ReacherWork = { brandName: string; shopId: number; handle: string; ids: string[] };
    const eukaWork: EukaWork[] = [];
    const reacherWork: ReacherWork[] = [];
    let total = 0, due = 0;

    const isDue = (id: string) => {
      const s = stored.get(id);
      const fresh = s && (s.known ? s.at > staleKnown : s.at > staleUnknown);
      return !(fresh && !force);
    };

    for (const [name, idHandle] of [...videos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (wanted && !wanted.has(name)) continue;
      const eOwner = matchBrand(name, euka);
      const rOwner = eOwner ? null : matchBrand(name, rshops);
      if (!eOwner && !rOwner) { unmapped.push(name); continue; }

      const mine: [string, string][] = [];
      for (const [id, handle] of idHandle) {
        if (claimed.has(id)) continue;
        if (onlyIds && !onlyIds.includes(id)) continue;
        total++;
        if (!isDue(id)) continue;
        claimed.add(id);
        mine.push([id, handle]);
      }
      /* never-read first, then the oldest, so an interrupted run resumes where it left off */
      mine.sort((a, b) => (stored.get(a[0])?.at ?? 0) - (stored.get(b[0])?.at ?? 0));
      due += mine.length;

      if (eOwner) {
        const ids = mine.map((m) => m[0]);
        for (let i = 0; i < ids.length; i += BATCH) eukaWork.push({ brandName: name, brand: eOwner, ids: ids.slice(i, i + BATCH) });
      } else if (rOwner) {
        reacherBrands.push(name);
        /* one read per creator handle, the handle holding the stalest videos first */
        const byHandle = new Map<string, string[]>();
        for (const [id, handle] of mine) {
          if (!handle) { unmapped.push(`${name} (a video with no creator handle)`); continue; }
          (byHandle.get(handle) ?? byHandle.set(handle, []).get(handle)!).push(id);
        }
        for (const [handle, ids] of byHandle) reacherWork.push({ brandName: name, shopId: rOwner.id, handle, ids });
      }
    }

    let read = 0, known = 0, unknown = 0, nonUsd = 0;
    const failed: string[] = [];
    const sample: Row[] = [];
    const keep = async (rows: Row[]) => {
      known += rows.filter((r) => r.known).length;
      unknown += rows.filter((r) => !r.known).length;
      if (dryRun) {
        if (sample.length < 8) sample.push(...rows.filter((r) => r.known).slice(0, 8 - sample.length));
        return;
      }
      if (!rows.length) return;
      const { error } = await db.from('collab_video_metrics').upsert(rows, { onConflict: 'item_id' });
      if (error) throw new Error(error.message);
    };

    /* Euka: three calls a batch, a few batches at a time */
    await pool(eukaWork, CONCURRENCY, async (w) => {
      if (Date.now() > deadline - 15_000) return;
      try {
        const got = await readEukaBatch(w.brand, w.ids, today);
        read += w.ids.length;
        nonUsd += got.nonUsd;
        await keep(got.rows);
      } catch (e) {
        failed.push(`${w.brandName}: ${String((e as Error).message).slice(0, 140)}`);
      }
    });

    /* Reacher: one creator at a time, paced, with whatever time is left */
    let rHandles = 0, rRead = 0, rTruncated = 0;
    for (const w of reacherWork) {
      if (Date.now() > deadline - 15_000) break;
      try {
        const got = await readReacherHandle(w.shopId, w.handle, w.ids, today, deadline - 10_000);
        rHandles++;
        rRead += got.rows.length;
        read += got.rows.length;
        nonUsd += got.nonUsd;
        rTruncated += got.truncated;
        await keep(got.rows);
      } catch (e) {
        failed.push(`${w.brandName} @${w.handle}: ${String((e as Error).message).slice(0, 140)}`);
      }
    }

    return json({
      dryRun: !!dryRun,
      windowEnd: today,
      brandsWithVideos: videos.size,
      unmapped,
      videos: total,
      due,
      read,
      known,
      unknown,
      nonUsd,
      remaining: Math.max(0, due - read),
      reacher: { brands: reacherBrands, handlesDue: reacherWork.length, handlesRead: rHandles, videosRead: rRead, truncated: rTruncated },
      failed,
      ...(dryRun ? { sample } : {}),
      ms: Date.now() - started,
    }, 200, req);
  } catch (e) {
    return json({ error: String((e as Error).message).slice(0, 200) }, 500, req);
  }
});
