/**
 * THE CLIENT'S DOOR INTO PAID COLLABS. No login, one brand or a few, read only.
 *
 * Rashid, 2026-09-17: "clients would need no login at all ... Only read access
 * and only the brand they have been shared."
 *
 * WHY A FUNCTION AND NOT A POLICY. `anon` has no grant on the `wurxbase` schema
 * and is never getting one ("anon gets nothing. Paid Collabs is behind a login
 * and always will be", 20260828141439). So a client's browser never speaks to
 * Postgres at all: it speaks to this, which runs as the service role, proves
 * the link, and answers with a PROJECTION — a payload built field by field.
 *
 * THE PROJECTION IS THE SECURITY BOUNDARY, not the page. Everything a client
 * must not see is never read into this payload in the first place:
 *   - never: ad spend, ROI, allocated, paid, cost per video, payment status,
 *     whatsapp_number, email, paypal, zelle, comments, airtable_id, row ids
 *   - a section switched off is ABSENT, not hidden: no key, no rows
 * A field that is merely hidden on screen is one "view source" away from being
 * visible, and this data belongs to somebody's client.
 *
 * WHAT IT SERVES, per Rashid's choices on 2026-09-17: brand budget and what is
 * left; the ten top videos; each creator's name, TikTok, tier-less row, deal
 * amount and per-video rate, delivery, views, GMV and items sold; and each
 * video with its spark code. Ad spend and ROI are the two he named to hide,
 * and the rest of the money follows from his answers.
 *
 * FAILURE IS ONE MESSAGE. Unknown, expired and revoked all answer with the same
 * 404 and the same sentence: a probe must not be able to tell a real link that
 * expired from a link that never existed.
 */
import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import { handleKey, mergeTiers, type TierMap } from '../_shared/euka-tiers.ts';

/* 24 random bytes, url-safe and unpadded, is exactly 32 characters. */
const Body = z.object({
  token: z.string().trim().regex(/^[A-Za-z0-9_-]{32}$/),
  /* 'YYYY-MM', or 'all' for every month at once. */
  month: z.string().trim().regex(/^(\d{4}-\d{2}|all)$/).optional(),
});

const GONE = 'This link is not active any more. Ask whoever shared it for a new one.';

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ── the vendored app's own arithmetic, copied so the numbers agree ──────── */
/* WurxUI.jsx parseDealAmount */
function dealAmount(deal: unknown): number {
  if (!deal) return 0;
  const m = String(deal).match(/\$?(\d[\d,]*\.?\d*)/);
  return m ? parseFloat(m[1]!.replace(/,/g, '')) || 0 : 0;
}
/* WurxUI.jsx parseDealVideos */
function dealVideos(deal: unknown): number {
  if (!deal) return 0;
  const s = String(deal);
  const m1 = s.match(/(\d+)\s*(?:videos?|vids?|clips?|posts?)\b/i);
  if (m1) return parseInt(m1[1]!, 10);
  const m2 = s.match(/\$\s*\d[\d,]*(?:\.\d+)?\s*(?:[/\-x×*]|for)\s*(\d+)\b/i);
  if (m2) return parseInt(m2[1]!, 10);
  const m3 = s.match(/\b(\d+)\s*[vV]\b/);
  if (m3) return parseInt(m3[1]!, 10);
  return 0;
}
/* WurxUI.jsx deliveredVideoCount: DISTINCT videos, because the same link can
   be stored twice and counting it twice credits delivery that never happened. */
function videoKey(url: string): string {
  const m = url.match(/video\/(\d+)/);
  return m ? m[1]! : url.toLowerCase().split(/[?#]/)[0]!.replace(/\/+$/, '');
}

type Row = Record<string, any>;

const monthOf = (d: unknown) => String(d ?? '').slice(0, 7);
/* Euka's tier and L30 GMV are READ from our own table here and refreshed
   elsewhere: see _shared/euka-tiers.ts for why a client page must never make
   that call itself. */

async function paged(build: (from: number, to: number) => any): Promise<Row[]> {
  const out: Row[] = [];
  const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await build(from, from + size - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < size) return out;
  }
}

/*
 * THE THREE READS A CLIENT PAGE NEEDS, AND HOW LONG THEY ARE KEPT.
 *
 * Rashid, 2026-11-02: opening a client link took "really long", and switching
 * month took longer still. Measured, the database was never the slow part (the
 * biggest brand reads in 2 ms); the time was the function making six HTTPS
 * calls to it one after another, from wherever the visitor happened to be, and
 * doing the whole job again for every month clicked.
 *
 * So the three reads that do not depend on each other now run together, and
 * their answer is kept for a minute. A month switch, and the page quietly
 * fetching the other months after it opens, then cost no database reads at all.
 *
 * WHAT IS NOT CACHED, ON PURPOSE: the link itself. Whether a link is live,
 * expired or revoked is read from the database on EVERY request, so revoking one
 * still takes effect at once. Only the brand's rows, which are the same for
 * whoever holds a link to that brand, are reused, and for at most a minute: the
 * page's own footer already says figures "update through the day".
 *
 * Kept per isolate, in memory, so a cold isolate simply reads again.
 */
const ROWS_TTL_MS = 60_000;
const ROWS_MAX = 24;
type Shared = { creators: Row[]; budgets: Row[] };
const rowsCache = new Map<string, { at: number; p: Promise<Shared> }>();
let tiersCache: { at: number; p: Promise<TierMap> } | null = null;

function loadShared(db: any, brands: string[]): Promise<Shared> {
  const key = JSON.stringify([...brands].sort());
  const hit = rowsCache.get(key);
  if (hit && Date.now() - hit.at < ROWS_TTL_MS) return hit.p;
  const p = (async (): Promise<Shared> => {
    /* An explicit column list, not select('*'): the staff screen reads every
       column including phone numbers and payment details, and a projection
       that starts from everything is one forgotten delete from a leak. */
    const [creators, budgets] = await Promise.all([
      paged((from, to) =>
        db.schema('wurxbase').from('creators')
          .select('name, brand, hiring_date, deal, videos, video_codes, tiktok_account, tiktok_account_2, category, product, hired_by, payment_status, monthly')
          .in('brand', brands)
          .not('name', 'is', null).neq('name', '')
          .or('status.eq.approved,status.is.null')
          .order('hiring_date', { ascending: false })
          .range(from, to)),
      paged((from, to) =>
        db.schema('wurxbase').from('brand_monthly_budgets')
          .select('brand, month, budget, content_guide_url, focus_product_url')
          .in('brand', brands).range(from, to)),
    ]);
    return { creators, budgets };
  })();
  /* A failed read must not be remembered for a minute. */
  p.catch(() => { if (rowsCache.get(key)?.p === p) rowsCache.delete(key); });
  rowsCache.set(key, { at: Date.now(), p });
  while (rowsCache.size > ROWS_MAX) rowsCache.delete(rowsCache.keys().next().value as string);
  return p;
}

/* Euka's tier and L30 GMV are READ from our own table here and refreshed
   elsewhere: see _shared/euka-tiers.ts for why a client page must never make
   that call itself. Every store is merged, because one creator's last-30-day
   GMV is their whole GMV across every shop they post for. The merged map is the
   same for every link, so it is shared by all of them. */
function loadTiers(db: any): Promise<TierMap> {
  if (tiersCache && Date.now() - tiersCache.at < ROWS_TTL_MS) return tiersCache.p;
  const p = (async (): Promise<TierMap> => {
    let tiers: TierMap = {};
    try {
      const { data: cacheRows } = await db.from('collab_share_euka_cache').select('handles');
      for (const row of cacheRows ?? []) tiers = mergeTiers(tiers, (row.handles ?? {}) as TierMap);
    } catch { /* leave the two columns empty rather than failing the page */ }
    return tiers;
  })();
  tiersCache = { at: Date.now(), p };
  return p;
}

/* Run after the answer has gone, never before it. A failure here must not turn
   a good page into an error, which it used to. */
function afterResponse(work: Promise<unknown>) {
  const safe = work.catch((e) => console.error('collab-share view log', String((e as Error)?.message ?? e).slice(0, 200)));
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === 'function') rt.waitUntil(safe);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json({ error: 'Bad request' }, 405, req);
  const t0 = performance.now();

  const db = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  let parsed;
  try {
    parsed = Body.safeParse(await req.json());
  } catch {
    return json({ error: 'Bad request' }, 400, req);
  }
  if (!parsed.success) return json({ error: 'Bad request' }, 400, req);
  const { token } = parsed.data;

  /* ── is this link real, live and ours? ────────────────────────────────── */
  const { data: link, error: linkErr } = await db
    .from('collab_share_links')
    .select('id, label, brands, months, show_kpis, show_top_videos, show_creators, show_videos, expires_at, revoked_at, token_hash, view_count')
    .eq('token_hash', await sha256Hex(token))
    .maybeSingle();
  if (linkErr) return json({ error: 'Something went wrong. Try again shortly.' }, 500, req);
  if (!link || link.revoked_at || new Date(link.expires_at).getTime() <= Date.now()) {
    return json({ error: GONE }, 404, req);
  }

  try {
    const brands: string[] = (link.brands ?? []).map((b: string) => String(b).trim()).filter(Boolean);

    /* ── the rows for these brands, and nothing else, all at once ──────── */
    /* The whole-table read that counted a person's campaigns is gone with the
       circle it fed: a client page should not walk every brand's roster to
       draw a number the client is not allowed to see. */
    const tLink = performance.now();
    const [{ creators, budgets }, tiers] = await Promise.all([loadShared(db, brands), loadTiers(db)]);
    const tData = performance.now();

    /* ── which months this link may show, and which one was asked for ──── */
    /*
     * An EMPTY whitelist means every month. A non-empty one is the whole truth
     * for this client: the switcher offers those months, "all" means all of
     * THOSE, and a month asked for outside the list is answered with one inside
     * it rather than refused — a client who edits the URL sees no more than a
     * client who clicks. Rashid, 2026-09-17: "which data should be shared with
     * them and which not like which month data".
     */
    const allowed: string[] = (link.months ?? []).filter((m: string) => /^\d{4}-\d{2}$/.test(String(m)));
    const monthOk = (m: string) => allowed.length === 0 || allowed.includes(m);
    const months = [...new Set(creators.map((c) => monthOf(c.hiring_date)).filter((m) => /^\d{4}-\d{2}$/.test(m)))]
      .filter(monthOk)
      .sort().reverse();
    const asked = parsed.data.month ?? months[0] ?? 'all';
    const month = asked === 'all' || months.includes(asked) ? asked : (months[0] ?? 'all');
    const inScope = (c: Row) =>
      month === 'all' ? monthOk(monthOf(c.hiring_date)) : monthOf(c.hiring_date) === month;

    /* tier and L30 GMV (`tiers`, above) are REFRESHED BY euka-ads-sync, NOT HERE.
       Each refresh is two multi-thousand row Euka exports; doing that inside
       this request left the next client view queued behind it and two in five
       timed out (2026-09-18). A client page is a database read, and the figures
       are at most half an hour old. */

    /* ── the payload, built field by field ─────────────────────────────── */
    const data = brands.map((brand) => {
      const rows = creators.filter((c) => String(c.brand ?? '').trim() === brand && inScope(c));

      const people = rows.map((c) => {
        const vids: Row[] = Array.isArray(c.video_codes) ? c.video_codes : [];
        const seen = new Set<string>();
        const videos: Row[] = [];
        for (const v of vids) {
          const url = String(v?.video ?? '').trim();
          if (!url) continue;
          const k = videoKey(url);
          if (seen.has(k)) continue;
          seen.add(k);
          videos.push({
            url,
            date: String(v?.date ?? '').slice(0, 10) || null,
            views: Number(v?.views) || 0,
            gmv: Number(v?.revenue) || 0,
            items: Number(v?.items) || 0,
            product: v?.product ? String(v.product).slice(0, 120) : null,
            thumb: v?.thumb ? String(v.thumb) : null,
            /* Rashid, 2026-09-17: "share the spark codes", so a client can run
               ads on the work. The `auth` code beside it stays ours. */
            spark: link.show_videos && v?.adCode ? String(v.adCode).trim() || null : null,
          });
        }
        const amount = dealAmount(c.deal);
        const committed = dealVideos(c.deal);
        const delivered = videos.length;
        const done = c.videos === 'Done' || (committed > 0 && delivered >= committed);
        const dates = videos.map((v) => v.date).filter(Boolean).sort() as string[];
        /* Euka knows this person by handle; a creator with two handles has the
           tier of whichever carries one, and the GMV of both added up. */
        const known = [c.tiktok_account, c.tiktok_account_2]
          .map(handleKey).filter(Boolean)
          .map((h) => tiers[h]).filter(Boolean) as { tier: string; gmv: number }[];
        const live = known.reduce((t, e) => t + (Number(e.gmv) || 0), 0);
        /* LIVE FIRST, THEN THE STORED FIGURE — the staff row's own rule
           (`creatorL30` / `creatorTier` in WurxUI). `monthly.euka` is an old
           cache and a figure from it is worse than today's, but far better than
           a dash: Euka's creator list covers only the last thirty days and caps
           at 1000 rows per shop, so anyone quiet lately drops out of the live
           sweep entirely. Rashid, seeing dashes the staff screen does not have:
           "still can't see where is their gmv". Both screens now answer the
           same way. */
        const stored = (c.monthly && (c.monthly as Row).euka) || null;
        const l30 = live > 0 ? live : (Number(stored?.l30) > 0 ? Number(stored.l30) : 0);
        return {
          name: String(c.name ?? '').trim(),
          tier: known.find((e) => e.tier)?.tier || (stored?.tier ? String(stored.tier) : null),
          l30: l30 > 0 ? l30 : null,
          /* NO STATUS. It was shared for a few hours on 2026-09-17 because the
             "exact same view" instruction implied it; Rashid looked at the page
             and said "no need to show status". Whether we have paid a creator
             is between us and the creator. */
          tiktok: [c.tiktok_account, c.tiktok_account_2].map((h) => (h ? String(h).trim() : '')).filter(Boolean),
          hiredBy: c.hired_by ? String(c.hired_by).trim() : null,
          /* NO DEALS COUNT. The circle on the face says how many campaigns we
             have run with that person across every brand — which tells a client
             how busy their creators are with everybody else. Rashid, relaying
             the boss: "the deal no around the avatar ... that was for
             ourself". It is not counted here any more, so nothing to leak. */
          category: c.category ? String(c.category) : null,
          product: c.product ? String(c.product) : null,
          onboarded: String(c.hiring_date ?? '').slice(0, 10) || null,
          completedOn: done && dates.length ? dates[Math.min(committed > 0 ? committed : dates.length, dates.length) - 1] : null,
          /* The deal and its per-video rate, which the client does see. */
          deal: amount,
          perVideo: committed > 0 && amount > 0 ? Math.round(amount / committed) : null,
          committed,
          delivered,
          views: videos.reduce((t, v) => t + v.views, 0),
          gmv: videos.reduce((t, v) => t + v.gmv, 0),
          items: videos.reduce((t, v) => t + v.items, 0),
          videos: link.show_videos ? videos : undefined,
        };
      });

      const out: Row = { brand };

      if (link.show_kpis) {
        const budgetRows = budgets.filter((b) => String(b.brand ?? '').trim() === brand
          && (month === 'all' ? monthOk(monthOf(b.month)) : monthOf(b.month) === month));
        const budget = budgetRows.reduce((t, b) => t + (Number(b.budget) || 0), 0);
        /* FROM THE ROWS, not from the projection. The projection stopped
           carrying each creator's deal when that column was removed, and this
           had been summing it — Allocated and Cost / Video both went blank,
           which is how a field disappearing from a payload silently empties a
           total computed from it. */
        const allocated = rows.reduce((t, c) => t + dealAmount(c.deal), 0);
        /* `c.payment_status === 'Paid'`, exactly as the staff row tests it. */
        const paid = rows
          .filter((c) => c.payment_status === 'Paid')
          .reduce((t, c) => t + dealAmount(c.deal), 0);
        const delivered = people.reduce((t, p) => t + p.delivered, 0);
        const committed = people.reduce((t, p) => t + p.committed, 0);
        /* THE SAME FIVE CARDS THE STAFF SCREEN SHOWS. Rashid's boss, 2026-09-17:
           "we need to show them exact same view as we have they will just not be
           able to see ad spend and roi at any cost". That supersedes the earlier
           "budget and remaining only"; DECISIONS says so. */
        out.kpis = {
          budget,
          allocated,
          paid,
          remaining: budget - allocated,
          creators: people.length,
          delivered,
          committed,
          /* ALLOCATED OVER COMMITTED VIDEOS, not delivered. The staff card says
             so in its own comment — "Cost / video = allocated / committed
             videos (Afflix semantics · not delivered)" — while its label reads
             "per delivered video". The label is theirs and the arithmetic is
             theirs; matching their NUMBER is what matters, and dividing by
             delivered put $238 on a client's screen beside Rashid's $46. */
          costPerVideo: committed > 0 ? allocated / committed : 0,
          views: people.reduce((t, p) => t + p.views, 0),
          gmv: people.reduce((t, p) => t + p.gmv, 0),
        };
        const guide = budgetRows.find((b) => b.content_guide_url)?.content_guide_url ?? null;
        if (guide) out.contentGuide = String(guide);
      }

      if (link.show_top_videos) {
        out.topVideos = people
          .flatMap((p) => (p.videos ?? []).length
            ? p.videos!.map((v: Row) => ({ ...v, name: p.name }))
            : [])
          .filter((v: Row) => v.gmv > 0)
          .sort((a: Row, b: Row) => b.gmv - a.gmv)
          .slice(0, 10)
          .map((v: Row) => ({ url: v.url, thumb: v.thumb, gmv: v.gmv, views: v.views, name: v.name }));
        /* The strip needs the videos even when the per-creator list is off, so
           it is built from the same rows and then trimmed to five fields. */
        if (!link.show_videos) {
          out.topVideos = rows
            .flatMap((c) => (Array.isArray(c.video_codes) ? c.video_codes : [])
              .filter((v: Row) => v?.video && Number(v?.revenue) > 0)
              .map((v: Row) => ({ url: String(v.video), thumb: v.thumb ? String(v.thumb) : null, gmv: Number(v.revenue) || 0, views: Number(v.views) || 0, name: String(c.name ?? '').trim() })))
            .sort((a, b) => b.gmv - a.gmv)
            .slice(0, 10);
        }
      }

      if (link.show_creators) {
        out.creators = people.map(({ videos, ...rest }) => (link.show_videos ? { ...rest, videos } : rest));
      }

      return out;
    });

    /* ── remember that somebody looked ─────────────────────────────────── */
    /*
     * AFTER THE ANSWER HAS GONE, and only for an OPEN. The page asks for a
     * month by name when somebody clicks one, and again for each of the other
     * months it fetches quietly in the background; counting those made one
     * person opening a link look like thirteen. "A view count climbing far
     * beyond one client is the only sign a shared secret has spread"
     * (OPERATIONS), so it has to count visits, not clicks.
     */
    if (parsed.data.month === undefined) {
      /* The address is salted with this link's own fingerprint, so the same
         visitor is recognisable within one link and nowhere else. */
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]!.trim();
      const ua = (req.headers.get('user-agent') ?? '').slice(0, 200) || null;
      afterResponse((async () => {
        await Promise.all([
          (async () => db.from('collab_share_views').insert({
            link_id: link.id,
            ip_hash: ip ? await sha256Hex(`${ip}:${link.token_hash}`) : null,
            user_agent: ua,
          }))(),
          db.from('collab_share_links')
            .update({ last_viewed_at: new Date().toISOString(), view_count: (link.view_count ?? 0) + 1 })
            .eq('id', link.id),
        ]);
      })());
    }

    const tDone = performance.now();
    return new Response(JSON.stringify({
      label: link.label,
      sections: {
        kpis: link.show_kpis,
        topVideos: link.show_top_videos,
        creators: link.show_creators,
        videos: link.show_videos,
      },
      months,
      month,
      expiresAt: link.expires_at,
      generatedAt: new Date().toISOString(),
      data,
    }), {
      status: 200,
      headers: {
        ...corsHeaders(req),
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        /* Where the time went, for the browser's Network panel. Numbers only. */
        'Server-Timing': `link;dur=${Math.round(tLink - t0)}, data;dur=${Math.round(tData - tLink)}, build;dur=${Math.round(tDone - tData)}`,
        'Access-Control-Expose-Headers': 'Server-Timing',
      },
    });
  } catch (e) {
    return json({ error: 'Something went wrong. Try again shortly.', detail: String((e as Error).message).slice(0, 200) }, 500, req);
  }
});
