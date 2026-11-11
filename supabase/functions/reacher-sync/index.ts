/**
 * reacher-sync
 * ---------------------------------------------------------------------------
 * Every Paid Collabs brand that Reacher holds and Euka does not, from Reacher into Paid Collabs.
 * (Until 2026-11-11 this was Irwin Naturals and nothing else; Biostime, also a Reacher shop,
 * had no video filed after 29 October. See ./targets.ts for which brands and how each is read.)
 *
 * The rules below were written about Irwin and still describe every brand. Two differences for
 * the others: their videos are read one creator at a time (a whole-shop list is too big), and
 * AD SPEND IS NOT WRITTEN for them, only for Irwin (Biostime's comes from Euka, and writing
 * Reacher's as well would count it twice).
 *
 * Rashid, 2026-09-23: "there is one brand we have Irwin Naturals, for that
 * brand we have Reacher api not euka ... we need same operations as we are
 * currently doing with euka api ... Please do not disturb anything, just for
 * Irwin Naturals we are going to do that."
 *
 * WHAT IT DOES, each run:
 *   1. Reads every video Reacher holds for the Irwin shop in the window.
 *   2. Files the ones we do not already have onto the matching Paid Collabs
 *      row, with their views, GMV, items, likes and comments — the same shape
 *      the team types by hand and the same shape Euka brands carry.
 *   3. Reads per-video GMV Max spend and writes it into `euka_ad_video_month`,
 *      so the brand page's Ad spend and ROI columns work with no new query.
 *   4. Writes one row to `reacher_sync_runs` saying what it found and changed.
 *
 * ═══ THE RULES THAT KEEP IT FROM DISTURBING ANYTHING ═══
 *
 *   - IRWIN ONLY. Every write is filtered to `brand = 'Irwin Naturals'`. A
 *     Reacher video whose creator is not on an Irwin row is counted and
 *     skipped, never filed against a creator's other brand.
 *   - ADD, NEVER REPLACE. A video already on a row is left exactly as it is,
 *     including its ad code and its typed figures. The team's own edits win;
 *     this only fills gaps.
 *   - A DASH IS NOT A ZERO. No GMV Max campaign is connected on that shop
 *     today, so no spend row is written and the column shows a dash. Writing
 *     zeros would state "nothing was spent", which we do not know.
 *   - READ ONLY AGAINST REACHER. `_shared/reacher.ts` refuses any path that is
 *     not on its read allow-list; their write endpoints create ad campaigns and
 *     cut creators out of delivery.
 *   - `dryRun: true` does everything except write, and reports what it would
 *     have done. The first live run was taken this way.
 *
 * WHO CAN RUN IT: the scheduler presenting `x-sync-secret`, or an active
 * ops/admin/ads_manager for a manual kick. Same gate as euka-ads-sync.
 */

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import {
  campaignCount,
  handleOf,
  reacherKey,
  shops as reacherShops,
  videoId,
  videoSpend,
  videos,
  type ReacherShop,
  type ReacherVideo,
} from '../_shared/reacher.ts';
import { EUKA_V0, eukaKeys } from '../_shared/euka-accounts.ts';
import { pickTargets, rotate, type Mode } from './targets.ts';

/** The brand these figures belong to, on our side. Nothing else is touched. */
const BRAND = 'Irwin Naturals';

const Body = z.object({
  dryRun: z.boolean().optional(),
  /** Only these Paid Collabs brands (as named there). Default: every brand Reacher holds and Euka does not. */
  brands: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  /** Creators read per run for a brand read creator by creator. Default 15; raise it for a manual backfill. */
  handlesPerRun: z.number().int().min(1).max(300).optional(),
  /** Defaults to the last 120 days, which covers a brand that started in August. */
  from: z.string().trim().max(20).optional(),
  to: z.string().trim().max(20).optional(),
  budgetMs: z.number().int().min(5_000).max(140_000).optional(),
});

const R_GAP_MS = 700; // Reacher allows about 60 reads a minute
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/** Euka's brand names (any key), so a brand Euka holds is left to Euka. */
async function eukaBrandNames(): Promise<{ name: string }[]> {
  const out: { name: string }[] = [];
  for (const k of eukaKeys()) {
    try {
      const r = await fetch(EUKA_V0 + '/brands', { headers: { Authorization: 'Bearer ' + k }, signal: AbortSignal.timeout(30_000) });
      if (!r.ok) continue;
      const list = await r.json();
      for (const b of Array.isArray(list) ? list : []) {
        const name = String(b?.name ?? '').trim();
        if (name) out.push({ name });
      }
    } catch {
      /* an account that does not answer is skipped: its brands would then be read from Reacher if Reacher has them */
    }
  }
  return out;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (day: string) => `${String(day).slice(0, 7)}-01`;

import { fillVideoThumbs } from '../_shared/video-thumbs.ts';
import { pickRow, placeVideos } from './placement.ts';

type VideoCode = Record<string, unknown>;

/**
 * One Reacher video in the shape Paid Collabs stores.
 *
 * The keys are theirs, read off real rows on 2026-09-23, so a filed video is
 * indistinguishable from a typed one to every screen that renders it. `src`
 * is ours and additive: it says where the row came from without changing how
 * anything reads it.
 */
function toVideoCode(v: ReacherVideo): VideoCode {
  return {
    video: String(v.video_url || v.tiktok_url || '').trim(),
    date: String(v.posted_date || '').slice(0, 10),
    views: Number(v.views) || 0,
    revenue: Number(v.video_gmv) || 0,
    items: Number(v.units_sold) || 0,
    likes: Number(v.like_count) || 0,
    comments: Number(v.comment_count) || 0,
    secs: 0,
    thumb: '',
    /* Reacher has no spark code outside GMV Max, and an empty string is what
       an un-sparked video carries in their data too. */
    adCode: '',
    auth: false,
    product: String(v.product_name || ''),
    src: 'reacher',
  };
}

/**
 * HOW MANY VIDEOS THE DEAL PROMISED. Copied verbatim from `parseDealVideos` in
 * `src/vendor/wurxbase/WurxUI.jsx`, because the number this returns decides
 * whether a creator shows as Payment Pending, and the browser and this function
 * must never read one deal string two different ways. If that one is ever
 * changed, change this with it — `pnpm verify:deal-complete` compares the two
 * against the real deal strings on every row so a drift is caught.
 */
function parseDealVideos(deal: unknown): number {
  if (!deal) return 0;
  const t = String(deal);
  const m1 = t.match(/(\d+)\s*(?:videos?|vids?|clips?|posts?)\b/i);
  if (m1) return parseInt(m1[1], 10);
  const m2 = t.match(/\$\s*\d[\d,]*(?:\.\d+)?\s*(?:[/\-x×*]|for)\s*(\d+)\b/i);
  if (m2) return parseInt(m2[1], 10);
  const m3 = t.match(/\b(\d+)\s*[vV]\b/);
  if (m3) return parseInt(m3[1], 10);
  return 0;
}

/** The video keys already on a row, by TikTok id where there is one. */
function keysOn(row: { video_codes?: unknown }): Set<string> {
  const out = new Set<string>();
  const list = Array.isArray(row.video_codes) ? row.video_codes : [];
  for (const v of list as Record<string, unknown>[]) {
    const url = String(v?.video ?? '').trim();
    if (!url) continue;
    out.add(videoId(url) ?? url.toLowerCase().replace(/\/+$/, ''));
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  const started = Date.now();

  const db: SupabaseClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  /* ── who is asking ───────────────────────────────────────────────────── */
  /* Timing-safe on the scheduler's secret, as euka-ads-sync and tiktok-sync do. */
  const secret = Deno.env.get('REACHER_SYNC_SECRET') ?? '';
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

  let raw: unknown = {};
  try {
    raw = await req.json();
  } catch {
    /* an empty body is a scheduled run */
  }
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) return json({ error: 'Bad request' }, 400, req);
  const dryRun = parsed.data.dryRun === true;

  if (!reacherKey()) {
    return json({ error: 'REACHER_API_KEY is not set on this project' }, 500, req);
  }

  const to = ISO.test(parsed.data.to ?? '') ? parsed.data.to! : iso(new Date());
  const from = ISO.test(parsed.data.from ?? '')
    ? parsed.data.from!
    : iso(new Date(Date.parse(`${to}T00:00:00Z`) - 120 * 86_400_000));

  const deadline = started + (parsed.data.budgetMs ?? 100_000);
  const cycle = Math.floor(Date.now() / 900_000); // moves a creator-by-creator brand's window along each 15 minutes
  const handlesPerRun = parsed.data.handlesPerRun ?? 15;

  /** One brand, from one Reacher shop. Irwin ('shop' mode) behaves exactly as it always has. */
  const syncBrand = async (BRAND: string, shop: ReacherShop, mode: Mode) => {
  const started = Date.now();
  const summary = {
    brand: BRAND, mode, handlesRead: 0, handlesTotal: 0,
    shop: '', shopId: 0, from, to, dryRun,
    videosSeen: 0, videosFiled: 0, creatorsMatched: 0,
    /* Filed videos whose figures moved on this run, and the money that
       appeared with them. Reported because "nothing new" and "nothing changed"
       are different answers, and the second one hid $1,000 for five days. */
    videosRefreshed: 0, gmvAdded: 0,
    /* Reacher videos moved onto the creator's row for the month they were posted. */
    videosMoved: 0, gmvMoved: 0,
    /* Pictures found for videos that had none, and rows moved to Payment
       Pending because the deal is now complete. Both reported, because both
       used to be somebody's manual job. */
    thumbsFilled: 0, thumbsMissing: 0, thumbsTruncated: false,
    markedDone: [] as string[],
    unmatchedHandles: [] as string[],
    /* The whole of what the roster does not cover, not just a sample. */
    unrosteredVideos: 0, unrosteredCreators: 0, unrosteredGmv: 0, unrosteredWritten: 0,
    campaigns: 0, spendRows: 0, spendWritten: 0,
    note: '' as string,
  };

  try {
    summary.shop = shop.shop_name;
    summary.shopId = shop.shop_id;

    /* ── 1. our rows for this brand, and only ours ────────────────────── */
    const rows: {
      id: number; name: string | null; hiring_date: string | null;
      tiktok_account: string | null; tiktok_account_2: string | null;
      video_codes: unknown;
      /* For the completion rule below. `deal` says how many videos were
         promised; `videos` is the flag the screens derive the status from. */
      deal: string | null; videos: string | null; payment_status: string | null;
    }[] = [];
    for (let page = 0; ; page += 500) {
      const { data, error } = await db.schema('wurxbase').from('creators')
        .select('id, name, hiring_date, tiktok_account, tiktok_account_2, video_codes, deal, videos, payment_status')
        .eq('brand', BRAND)
        .order('id')
        .range(page, page + 499);
      if (error) throw new Error(`reading ${BRAND} rows: ${error.message}`);
      rows.push(...(data ?? []));
      if ((data ?? []).length < 500) break;
    }

    /* A creator has a row per month. Put every Reacher video this function filed
       earlier on the row for the month it was posted (see placement.ts), in memory
       here and written below with the other changes. */
    const placement = placeVideos(rows, handleOf, videoId);
    summary.videosMoved = placement.moved;
    summary.gmvMoved = placement.movedGmv;

    /* handle → the row that claims it. A creator with two handles claims both. */
    const rowFor = new Map<string, typeof rows[number]>();
    const rowsFor = new Map<string, typeof rows>();
    for (const r of rows) {
      for (const h of [handleOf(r.tiktok_account), handleOf(r.tiktok_account_2)]) {
        if (!h) continue;
        if (!rowFor.has(h)) rowFor.set(h, r);
        const list = rowsFor.get(h) ?? [];
        if (!list.includes(r)) list.push(r);
        rowsFor.set(h, list);
      }
    }

    /* ── 2. the videos Reacher holds ───────────────────────────────────
       'shop': every video the shop holds in the window, in one list (Irwin).
       'handles': one creator at a time, for the creators on OUR roster, a rotating
       batch per run, because a big shop's whole list is cut off before it reaches ours. */
    let vids: ReacherVideo[] = [];
    if (mode === 'shop') {
      vids = await videos(shop.shop_id, from, to);
    } else {
      summary.handlesTotal = rowFor.size;
      for (const h of rotate([...rowFor.keys()], handlesPerRun, cycle)) {
        if (Date.now() > deadline - 12_000) break;
        vids.push(...(await videos(shop.shop_id, from, to, 500, h)));
        summary.handlesRead++;
        await sleep(R_GAP_MS);
      }
    }
    summary.videosSeen = vids.length;

    /*
     * ═══ THE LATEST FIGURES, BY VIDEO ═══════════════════════════════════
     *
     * ADD-NEVER-REPLACE WAS HALF A RULE, AND THE MISSING HALF COST REAL MONEY.
     * Reacher's own docs say affiliate data is up to three days stale, and GMV
     * lands days after a video is posted — so a video filed on the day it went
     * up is filed with $0, and nothing ever went back for it. On 2026-09-28
     * that was 50 of Irwin's 52 videos: the brand page read $34.63 against
     * Reacher's own $1,036.40 for a single creator.
     *
     * So: still never delete a video, still never touch a row that did not come
     * from Reacher — but REFRESH the figures on the ones that did. Numbers only
     * ever GROW here (`Math.max`), which is the same rule the screens use when
     * two rows disagree, and it means a short or partly-synced Reacher answer
     * can never wipe money that has already been recorded.
     */
    const latest = new Map<string, ReacherVideo>();
    for (const v of vids) {
      const url = String(v.video_url || v.tiktok_url || '').trim();
      if (!url) continue;
      const key = videoId(url) ?? url.toLowerCase().replace(/\/+$/, '');
      const prev = latest.get(key);
      if (!prev || Number(v.video_gmv || 0) > Number(prev.video_gmv || 0)) latest.set(key, v);
    }

    /* Group the videos we can place, by row. */
    const toFile = new Map<number, VideoCode[]>();
    const unmatched = new Set<string>();
    for (const v of vids) {
      const h = handleOf(v.creator_handle);
      const url = String(v.video_url || v.tiktok_url || '').trim();
      if (!h || !url) continue;
      const candidates = rowsFor.get(h);
      if (!candidates) { unmatched.add(h); continue; }
      /* The row for the month this video was posted, not the creator's oldest. */
      const row = pickRow(candidates, String(v.posted_date ?? ''))!;
      /* Already filed on ANY of the creator's rows counts as filed. */
      const have = new Set<string>();
      for (const o of candidates) for (const k of keysOn(o)) have.add(k);
      const key = videoId(url) ?? url.toLowerCase().replace(/\/+$/, '');
      if (have.has(key)) continue;            /* already filed; refreshed below */
      const list = toFile.get(row.id) ?? [];
      /* Two Reacher rows for one video (it can sit under two products) are one
         video to us; the first wins, as the count-once rule does everywhere. */
      if (list.some((x) => (videoId(String(x.video)) ?? String(x.video)) === key)) continue;
      list.push(toVideoCode(v));
      toFile.set(row.id, list);
    }
    /* Every Reacher video whose handle is on no roster row, once per video and
       with the best figures seen. Kept so they are visible; never filed onto a
       creator. */
    const unrostered: Record<string, unknown>[] = [];
    const unrosteredHandles = new Set<string>();
    let unrosteredGmv = 0;
    for (const [key, v] of mode === 'shop' ? latest : []) {
      const h = handleOf(v.creator_handle);
      const url = String(v.video_url || v.tiktok_url || '').trim();
      if (!h || !url || rowFor.has(h)) continue;
      unrosteredHandles.add(h);
      unrosteredGmv += Number(v.video_gmv) || 0;
      unrostered.push({
        video_key: key,
        shop_id: shop.shop_id,
        handle: h,
        video_url: url,
        posted_date: /^\d{4}-\d{2}-\d{2}/.test(String(v.posted_date ?? '')) ? String(v.posted_date).slice(0, 10) : null,
        views: Math.round(Number(v.views) || 0),
        gmv: Math.round((Number(v.video_gmv) || 0) * 100) / 100,
        units: Math.round(Number(v.units_sold) || 0),
        likes: Math.round(Number(v.like_count) || 0),
        comments: Math.round(Number(v.comment_count) || 0),
        product: String(v.product_name || '') || null,
        synced_at: new Date().toISOString(),
      });
    }
    summary.unrosteredVideos = unrostered.length;
    summary.unrosteredCreators = unrosteredHandles.size;
    summary.unrosteredGmv = Math.round(unrosteredGmv * 100) / 100;
    summary.creatorsMatched = toFile.size;
    summary.videosFiled = [...toFile.values()].reduce((s, l) => s + l.length, 0);
    summary.unmatchedHandles = [...unmatched].slice(0, 20);

    /* Refresh what is already filed, row by row, and remember what changed. */
    let refreshed = 0, gmvAdded = 0;
    const refreshedFor = new Map<number, VideoCode[]>();
    for (const row of rows) {
      const existing = Array.isArray(row.video_codes) ? row.video_codes as VideoCode[] : [];
      if (!existing.length) continue;
      let touched = false;
      const next = existing.map((rec) => {
        /* OURS ONLY. A typed row, or one EUKA filed, is not Reacher's to
           correct — that is how one source quietly overwrites another. */
        if (!rec || (rec as Record<string, unknown>).src !== 'reacher') return rec;
        const url = String(rec.video ?? '').trim();
        if (!url) return rec;
        const v = latest.get(videoId(url) ?? url.toLowerCase().replace(/\/+$/, ''));
        if (!v) return rec;
        const grow = (was: unknown, now: unknown) => Math.max(Number(was) || 0, Number(now) || 0);
        const fresh: VideoCode = {
          ...rec,
          views: grow(rec.views, v.views),
          revenue: grow(rec.revenue, v.video_gmv),
          items: grow(rec.items, v.units_sold),
          likes: grow(rec.likes, v.like_count),
          comments: grow(rec.comments, v.comment_count),
          /* A product name only ever fills a blank; it never overwrites one. */
          product: String(rec.product || '') || String(v.product_name || ''),
        };
        if (fresh.revenue !== rec.revenue || fresh.views !== rec.views
          || fresh.items !== rec.items || fresh.likes !== rec.likes || fresh.comments !== rec.comments) {
          touched = true;
          refreshed++;
          gmvAdded += (Number(fresh.revenue) || 0) - (Number(rec.revenue) || 0);
        }
        return fresh;
      });
      if (touched) refreshedFor.set(row.id, next);
    }
    summary.videosRefreshed = refreshed;
    summary.gmvAdded = Math.round(gmvAdded * 100) / 100;

    /*
     * ═══ WHAT EACH ROW ENDS UP WITH ═════════════════════════════════════
     *
     * Built for EVERY row, not only the ones with new or refreshed videos,
     * because the two things below have to be able to fix a row that this run
     * changes nothing else about — a creator who finished their deal weeks ago
     * and a video that has been sitting there without a picture are both
     * exactly that case.
     */
    const finalFor = new Map<number, VideoCode[]>();
    for (const row of rows) {
      const base = refreshedFor.get(row.id)
        ?? (Array.isArray(row.video_codes) ? row.video_codes as VideoCode[] : []);
      finalFor.set(row.id, [...base, ...(toFile.get(row.id) ?? [])]);
    }

    /*
     * ═══ PICTURES FOR THE VIDEOS WE FILED ═══════════════════════════════
     *
     * Rashid, 2026-09-29: "for irwin naturals the top videos row does not show
     * thumbnail". Reacher has none to give — the whole account is in
     * `_shared/video-thumbs.ts`, including why TikTok's own oEmbed, which works
     * perfectly, is the wrong answer (its URL expired the next day).
     *
     * The arrays are filled in place, so whatever this finds rides along on the
     * write below rather than costing a second one. It touches only entries we
     * filed ourselves; a typed video or one EUKA filed is not ours to write on.
     */
    const blanks = (list: VideoCode[]) =>
      list.filter((v) => v && (v as Record<string, unknown>).src === 'reacher'
        && !String((v as Record<string, unknown>).thumb ?? '').trim()).length;
    /* Counted per row BEFORE and after, so the write below can name the rows a
       picture actually landed on. Rewriting every row's whole video list
       because one of them gained a thumbnail would be a hundred needless
       writes, and each one is a chance to clobber something. */
    const blanksBefore = new Map<number, number>();
    for (const [id, list] of finalFor) blanksBefore.set(id, blanks(list));

    const thumbs = await fillVideoThumbs([...finalFor.values()] as Record<string, unknown>[][]);
    summary.thumbsFilled = thumbs.filled;
    summary.thumbsMissing = thumbs.missing;
    summary.thumbsTruncated = thumbs.truncated;

    const thumbRows = new Set<number>();
    for (const [id, list] of finalFor) {
      if (blanks(list) < (blanksBefore.get(id) ?? 0)) thumbRows.add(id);
    }

    /*
     * ═══ A FINISHED DEAL MOVES ITSELF TO PAYMENT PENDING ════════════════
     *
     * Rashid, 2026-09-29: "when a deal is completed such as a creator has made
     * 5/5 videos why does not it automatically move towards payment pending,
     * asad did it manually".
     *
     * BECAUSE THIS FUNCTION NEVER DID IT, AND EVERY OTHER PATH DOES. The status
     * on screen is derived from the `videos` flag, and both browser paths that
     * write videos — the EUKA merge and the video editor's save — recompute it
     * from the deal every time they write. This function wrote `video_codes`
     * and nothing else, so a creator whose videos arrive from Reacher finished
     * their deal and stayed in "Videos in Progress" until a human noticed.
     * Irwin is the only brand Reacher fills, which is why it is the only brand
     * where Asad had to do it by hand.
     *
     * The rule is the browser's rule, to the letter: enough videos delivered
     * against what the deal promised.
     *
     * IT ONLY EVER MOVES FORWARD. The browser also flips Done back to In
     * Progress when videos are removed; this function never removes one, so the
     * reverse could only ever undo a human's decision, and it is not written.
     * A row already marked Paid is left completely alone — being paid is
     * further along than being owed, and nothing here should walk that back.
     *
     * `payment_status` is NOT touched. The screens read Payment Pending from
     * the `videos` flag whenever the row is not Paid, so setting it would
     * change no status anywhere and would overwrite a field a human may have
     * put something in.
     */
    const flagFor = new Map<number, string>();
    for (const row of rows) {
      if (row.payment_status === 'Paid') continue;
      if (row.videos === 'Done') continue;
      const committed = parseDealVideos(row.deal);
      if (committed <= 0) continue;        /* no promised count, no rule to apply */
      const delivered = (finalFor.get(row.id) ?? [])
        .filter((v) => String((v as Record<string, unknown>).video ?? '').trim()).length;
      if (delivered < committed) continue;
      flagFor.set(row.id, 'Done');
      summary.markedDone.push(`${row.name ?? row.id} ${delivered}/${committed}`);
    }

    if (!dryRun) {
      /* One write per row, carrying the new videos, the refreshed ones, any
         picture just found and the completion flag, so a creator with all four
         does not get written four times. */
      const changedVideos = new Set([...toFile.keys(), ...refreshedFor.keys(), ...thumbRows, ...placement.touched]);
      const ids = new Set([...changedVideos, ...flagFor.keys()]);
      for (const id of ids) {
        const patch: Record<string, unknown> = {};
        /* Only send `video_codes` when something in THIS row's list actually
           changed — a row whose only news is the flag must not have its whole
           video list rewritten for nothing. */
        if (changedVideos.has(id)) patch.video_codes = finalFor.get(id) ?? [];
        const flag = flagFor.get(id);
        if (flag) patch.videos = flag;
        if (!Object.keys(patch).length) continue;
        const { error } = await db.schema('wurxbase').from('creators')
          .update(patch)
          .eq('id', id)
          .eq('brand', BRAND);            /* belt and braces: Irwin rows only */
        if (error) throw new Error(`filing videos on row ${id}: ${error.message}`);
      }
    }

    /* ── 2b. the videos nobody on the roster owns ──────────────────────── */
    if (!dryRun && mode === 'shop') {
      for (let i = 0; i < unrostered.length; i += 500) {
        const { error } = await db.from('reacher_unrostered_videos')
          .upsert(unrostered.slice(i, i + 500), { onConflict: 'video_key' });
        if (error) throw new Error(`keeping unrostered videos: ${error.message}`);
      }
      summary.unrosteredWritten = unrostered.length;
      /* A handle that has since joined the roster has its videos filed above;
         take them off this list so nothing is shown twice. */
      const rostered = [...rowFor.keys()];
      for (let i = 0; i < rostered.length; i += 200) {
        await db.from('reacher_unrostered_videos').delete()
          .eq('shop_id', shop.shop_id).in('handle', rostered.slice(i, i + 200));
      }
    }

    /* ── 3. per-video ad spend, if there is any ───────────────────────── */
    summary.campaigns = mode === 'shop' ? await campaignCount(shop.shop_id) : 0;
    if (mode === 'shop' && summary.campaigns > 0) {
      const { rows: spend, currency } = await videoSpend(shop.shop_id, from, to);
      summary.spendRows = spend.length;
      const out = spend.map((s) => {
        const id = String(s.video_id ?? '');
        return {
          item_id: id,
          /* The month a video's spend is filed under is the window's month, the
             same convention the Euka side uses for its monthly unit. */
          month: monthStart(to),
          store_id: String(shop.shop_id),
          advertiser_id: 'reacher',
          campaign_id: String(s.campaign_id ?? 'gmv-max'),
          cost: Number(s.spend ?? s.cost ?? 0),
          orders: Number(s.orders ?? 0),
          gross_revenue: Number(s.revenue ?? s.gross_revenue ?? 0),
          currency,
          source: 'reacher',
          synced_at: new Date().toISOString(),
        };
      }).filter((r) => /^[0-9]{6,32}$/.test(r.item_id));
      if (!dryRun && out.length) {
        const { error } = await db.from('euka_ad_video_month')
          .upsert(out, { onConflict: 'item_id,month,advertiser_id,campaign_id' });
        if (error) throw new Error(`writing ad figures: ${error.message}`);
      }
      summary.spendWritten = dryRun ? 0 : out.length;
    } else if (mode !== 'shop') {
      summary.note = "Videos only: this brand's ad spend is not read from Reacher.";
    } else {
      summary.note = 'No GMV Max campaign is connected on this Reacher shop, so there is no ad spend to read. Ad spend and ROI stay as a dash rather than a zero.';
    }

    if (!dryRun) {
      await db.from('reacher_sync_runs').insert({
        shop_id: shop.shop_id,
        shop_name: shop.shop_name,
        videos_seen: summary.videosSeen,
        videos_filed: summary.videosFiled,
        creators_matched: summary.creatorsMatched,
        spend_rows: summary.spendWritten,
        campaigns_seen: summary.campaigns,
        ok: true,
        note: summary.note || null,
        ms: Date.now() - started,
      });
    }

    return { ...summary, ms: Date.now() - started };
  } catch (e) {
    const note = String((e as Error).message).slice(0, 400);
    /* A failed run is RECORDED. An empty log and a broken sync look identical
       otherwise, which is the failure this project keeps meeting. */
    if (!dryRun) {
      await db.from('reacher_sync_runs').insert({
        shop_id: summary.shopId || 0,
        shop_name: summary.shop || BRAND,
        videos_seen: summary.videosSeen,
        videos_filed: 0,
        creators_matched: 0,
        spend_rows: 0,
        campaigns_seen: summary.campaigns,
        ok: false,
        note,
        ms: Date.now() - started,
      }).then(() => {}, () => {});
    }
    return { error: note, ...summary, ms: Date.now() - started };
  }
  };

  /* ── which brands, and one read per brand ─────────────────────────── */
  let selection: ReturnType<typeof pickTargets>;
  const byId = new Map<number, ReacherShop>();
  try {
    const rs = await reacherShops();
    for (const x of rs) byId.set(x.shop_id, x);
    const euka = eukaKeys().length ? await eukaBrandNames() : [];
    const ours: string[] = [];
    for (let page = 0; ; page += 1000) {
      const { data, error } = await db.schema('wurxbase').from('creators').select('brand').order('id').range(page, page + 999);
      if (error) throw new Error('reading brands: ' + error.message);
      ours.push(...(data ?? []).map((r: { brand?: string | null }) => String(r.brand ?? '')));
      if (!data || data.length < 1000) break;
    }
    selection = pickTargets(
      ours,
      euka,
      rs.map((x) => ({ name: x.shop_name, id: x.shop_id })),
      parsed.data.brands ? new Set(parsed.data.brands.map((b) => b.trim())) : null,
    );
  } catch (e) {
    return json({ error: String((e as Error).message).slice(0, 400) }, 500, req);
  }

  const results: Record<string, unknown>[] = [];
  for (const t of selection.targets) {
    if (Date.now() > deadline - 15_000) break;
    results.push(await syncBrand(t.brand, byId.get(t.shop.id)!, t.mode));
  }

  const sum = (k: string) => results.reduce((n, r) => n + (Number(r[k]) || 0), 0);
  const failed = results.filter((r) => r.error);
  /* One brand asked for and it failed: report it the way this function always reported a failure. */
  if (results.length === 1 && failed.length === 1) return json(results[0], 500, req);
  return json({
    /* A single brand's own figures stay at the top level, so callers written for Irwin read the same fields. */
    ...(results.length === 1 ? results[0] : {}),
    dryRun,
    videosFiled: sum('videosFiled'),
    creatorsMatched: sum('creatorsMatched'),
    spendWritten: sum('spendWritten'),
    note: results.length === 1 ? (results[0]!.note ?? '') : '',
    brands: results,
    skipped: { euka: selection.euka, neither: selection.neither },
    ms: Date.now() - started,
  }, 200, req);
});
