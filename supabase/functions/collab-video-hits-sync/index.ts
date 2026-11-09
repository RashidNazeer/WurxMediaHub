/**
 * collab-video-hits-sync
 * ---------------------------------------------------------------------------
 * Each Paid Collabs video's GMV for the last 30 and 90 days, and its lifetime views, from
 * Euka, into `collab_video_metrics`. That table feeds the creator Hit Rate (a video is a
 * hit at $1,000 in either window or 250,000 views; the rule lives in SQL, in
 * `collab_video_hit_reasons`, and nothing here decides what a hit is).
 *
 * WHY EUKA AND WHY THIS WAY. The rows in `wurxbase.creators.video_codes` hold one
 * overwritten lifetime `revenue` per video, which cannot answer "GMV in the last 30 days".
 * Euka's `POST /api/v1/videos/search` can: scope `commerceWindow` returns the sales a video
 * earned inside a date range (whenever it was posted), and scope `lifetime` returns its
 * lifetime views, for up to 100 explicit TikTok video ids per call. Three calls a batch.
 *
 * WHAT A MISSING ANSWER MEANS (and this is the rule that keeps hit rates honest):
 *   - Euka does not return a video it does not hold. If the lifetime read does not list the
 *     id, the video is recorded `known = false` and every figure stays NULL: unverified,
 *     never zero, never a hit.
 *   - If the lifetime read DOES list it but a window omits it, the video had no sales in that
 *     window: stored as 0 (an observed zero).
 *   - A window figure in a currency other than USD is not compared with a dollar threshold:
 *     it is stored NULL (unverified) and counted in `nonUsd`.
 *
 * BOTH WINDOWS END ON THE SAME DAY and are written in one upsert, so a video's 30 and 90 day
 * figures never come from different dates. `window_end` is that day.
 *
 * READ ONLY AGAINST EUKA (a POST of a filter). The only thing written is our own table.
 * WHO CAN RUN IT: the scheduler presenting `x-sync-secret` (same secret as the other collab
 * syncs), or an active ops/admin/ads_manager for a manual kick.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import { EUKA_V0, EUKA_V1, eukaKeys, type EukaAuth } from '../_shared/euka-accounts.ts';
import { matchBrand } from '../_shared/collab-gmv.ts';

const Body = z.object({
  /** Only these Paid Collabs brands. Default: every brand that has videos. */
  brands: z.array(z.string().min(1).max(120)).max(100).optional(),
  /** Read even what is fresh. */
  force: z.boolean().optional(),
  /** Read Euka and report, write nothing; returns a sample of what it would store. */
  dryRun: z.boolean().optional(),
  /** Only these TikTok video ids (debugging). */
  ids: z.array(z.string().regex(/^\d+$/)).max(200).optional(),
  budgetMs: z.number().int().min(5_000).max(140_000).optional(),
});

type Db = SupabaseClient;

const BATCH = 100; // Euka's cap on explicit video ids per call
const PAGES_MAX = 3; // a 100-id read is one page; this only guards a surprise
const FRESH_HOURS = 20; // known videos are re-read once their window has moved
const UNKNOWN_DAYS = 3; // a video Euka did not hold is asked about again after this long
const CONCURRENCY = 3;

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDay(d);
};

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
const round2 = (n: number) => Math.round(n * 100) / 100;

type Row = {
  item_id: string;
  known: boolean;
  gmv_30d: number | null;
  gmv_90d: number | null;
  views: number | null;
  lifetime_gmv: number | null;
  window_end: string;
  source_through: string | null;
  fetched_at: string;
};

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

/** Read one batch (<= 100 ids of one brand) and turn it into rows. */
async function readBatch(brand: { id: string; auth: EukaAuth }, ids: string[], end: string) {
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
      return { item_id: id, known: false, gmv_30d: null, gmv_90d: null, views: null, lifetime_gmv: null, window_end: end, source_through: null, fetched_at: now };
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
      fetched_at: now,
    };
  });
  return { rows, nonUsd };
}

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

/** Each Paid Collabs brand's distinct TikTok video ids, from the creators' video rows. */
async function loadVideos(db: Db): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (let from = 0; ; from += 500) {
    const { data, error } = await db.schema('wurxbase').from('creators').select('brand, video_codes').order('id').range(from, from + 499);
    if (error) throw new Error(error.message);
    for (const c of (data ?? []) as { brand?: string; video_codes?: { video?: string }[] | null }[]) {
      const brand = String(c.brand ?? '').trim();
      if (!brand) continue;
      for (const v of Array.isArray(c.video_codes) ? c.video_codes : []) {
        const id = /\/video\/(\d+)/.exec(String(v?.video ?? ''))?.[1];
        if (!id) continue;
        let s = out.get(brand);
        if (!s) out.set(brand, (s = new Set()));
        s.add(id);
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
    if (!eukaKeys().length) return json({ error: 'No Euka key is configured' }, 503, req);
    const euka = await eukaBrands();
    const videos = await loadVideos(db);
    const stored = await loadStored(db);
    const today = isoDay(new Date());
    const staleKnown = Date.now() - FRESH_HOURS * 3_600_000;
    const staleUnknown = Date.now() - UNKNOWN_DAYS * 86_400_000;

    const wanted = parsed.data.brands ? new Set(parsed.data.brands.map((b) => b.trim())) : null;
    const unmapped: string[] = [];
    const claimed = new Set<string>(); // a video under two brands is asked about once, under the first that owns it
    type Work = { brandName: string; brand: { id: string; auth: EukaAuth }; ids: string[] };
    const work: Work[] = [];
    let total = 0, due = 0;

    for (const [name, set] of [...videos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (wanted && !wanted.has(name)) continue;
      const owner = matchBrand(name, euka);
      if (!owner) { unmapped.push(name); continue; }
      const mine: string[] = [];
      for (const id of set) {
        if (claimed.has(id)) continue;
        if (onlyIds && !onlyIds.includes(id)) continue;
        total++;
        const s = stored.get(id);
        const fresh = s && (s.known ? s.at > staleKnown : s.at > staleUnknown);
        if (fresh && !force) continue;
        claimed.add(id);
        mine.push(id);
      }
      /* never-read first, then the oldest, so an interrupted run resumes where it left off */
      mine.sort((a, b) => (stored.get(a)?.at ?? 0) - (stored.get(b)?.at ?? 0));
      due += mine.length;
      for (let i = 0; i < mine.length; i += BATCH) work.push({ brandName: name, brand: owner, ids: mine.slice(i, i + BATCH) });
    }

    let read = 0, known = 0, unknown = 0, nonUsd = 0;
    const failed: string[] = [];
    const sample: Row[] = [];
    await pool(work, CONCURRENCY, async (w) => {
      if (Date.now() > deadline - 15_000) return;
      try {
        const got = await readBatch(w.brand, w.ids, today);
        read += w.ids.length;
        nonUsd += got.nonUsd;
        known += got.rows.filter((r) => r.known).length;
        unknown += got.rows.filter((r) => !r.known).length;
        if (dryRun) {
          if (sample.length < 6) sample.push(...got.rows.filter((r) => r.known).slice(0, 6 - sample.length));
          return;
        }
        const { error } = await db.from('collab_video_metrics').upsert(got.rows, { onConflict: 'item_id' });
        if (error) throw new Error(error.message);
      } catch (e) {
        failed.push(`${w.brandName}: ${String((e as Error).message).slice(0, 140)}`);
      }
    });

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
      failed,
      ...(dryRun ? { sample } : {}),
      ms: Date.now() - started,
    }, 200, req);
  } catch (e) {
    return json({ error: String((e as Error).message).slice(0, 200) }, 500, req);
  }
});
