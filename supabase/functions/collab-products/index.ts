/**
 * collab-products
 * ---------------------------------------------------------------------------
 * A brand's products, whichever platform that brand sells on.
 *
 * Rashid, 2026-09-23: "when we onboard a creator we need to write product name
 * — we want to fetch products for that brand from the api so ... it will show
 * us the dropdown to choose the product from ... do it for reacher and euka as
 * well".
 *
 * Onboarding has had a free-text product box and a few chips typed by hand into
 * the brand's focus products. Both APIs can answer the question properly:
 *
 *   EUKA     POST /api/v1/dashboard/products-performance   (brandId = their
 *            brand id for the store, which is NOT the store id — see
 *            storeBrandPair, which exists because that mismatch is easy)
 *   REACHER  POST /public/v1/products/catalog              (x-shop-id)
 *
 * ONE SHAPE COMES BACK, whichever answered: `{ id, name, image, price, status }`
 * plus the source. The modal that renders the dropdown should not have to know
 * which platform a brand is on, and the day a brand moves between them nothing
 * on the screen changes.
 *
 * READ ONLY, and staff only. Reacher's key can create ad campaigns, so this
 * goes through `_shared/reacher.ts`, whose allow-list refuses any path that is
 * not one of four reads.
 */

import { createClient } from 'npm:@supabase/supabase-js@2.110.9';
import { z } from 'npm:zod@4.4.3';
import { corsHeaders, json } from '../_shared/cors.ts';
import { EUKA_V1, eukaKeys, indexStores, storeBrandPair } from '../_shared/euka-accounts.ts';
import { findShop, read as reacherRead, reacherKey, shops as reacherShops } from '../_shared/reacher.ts';
import { attachProductImages } from '../_shared/product-images.ts';

const Body = z.object({
  brand: z.string().trim().min(1).max(120),
  /** How far back to look for products that have actually sold. */
  days: z.number().int().min(7).max(365).optional(),
  /**
   * WHICH PLATFORM, WITHOUT THE CATALOGUE. The brand page asks this on every
   * open just to label its own button, and fetching 45 products to answer
   * "Euka or Reacher?" would make that page wait on two APIs for nothing.
   */
  probe: z.boolean().optional(),
});

type Product = {
  id: string;
  name: string;
  image?: string | null;
  price?: string | null;
  status?: string | null;
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * ANY EUKA ACCOUNT, FOR THE MARKET LOOKUP ONLY.
 *
 * `euka-accounts.ts` insists a store is only ever asked about with the key that
 * returned it, and that rule is not being bent here: the market endpoint takes
 * a public TikTok product id and no store or brand id at all, so the answer
 * does not depend on which of our accounts asks. It is what lets a Reacher
 * brand — which has no Euka store anywhere — still get product pictures.
 */
const marketAuth = () => {
  const k = eukaKeys()[0];
  return k ? { Authorization: `Bearer ${k}` } : null;
};

/* The modal caches per brand on its own side; `json()` here sends no cache
   header, and adding one would be a lie about what this helper does. */

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  /* ── who is asking ───────────────────────────────────────────────────── */
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in' }, 401, req);
  const { data: who } = await admin.auth.getUser(token);
  if (!who?.user) return json({ error: 'Not signed in' }, 401, req);
  const { data: profile } = await admin.from('profiles').select('role, is_active').eq('id', who.user.id).single();
  /* The same list the `euka` proxy admits: staff plus the three read-only Paid
     Collabs roles, who use the same screens. A creator must never reach this —
     it describes other brands' catalogues. */
  const ROLES = ['admin', 'ops', 'affiliate_team_lead', 'operations_lead', 'ads_manager'];
  if (!profile?.is_active || !ROLES.includes(profile.role)) return json({ error: 'Not allowed' }, 403, req);

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return json({ error: 'Bad request', detail: String((e as Error).message).slice(0, 200) }, 400, req);
  }

  const to = new Date();
  const from = new Date(Date.now() - (body.days ?? 120) * 86_400_000);
  const brand = body.brand.trim();

  /* ── 1. Euka, which covers most brands ───────────────────────────────── */
  try {
    const keys = eukaKeys();
    if (keys.length) {
      const index = await indexStores(keys);
      const store = index.stores.find((s) => norm(s.name) === norm(brand))
        /* Their store names carry suffixes ours do not ("Swisse Wellness" for
           "Swisse"), so a contains match is the fallback, longest first so the
           most specific store wins. */
        ?? [...index.stores].sort((a, b) => b.name.length - a.name.length)
          .find((s) => norm(s.name).includes(norm(brand)) || norm(brand).includes(norm(s.name)));
      if (store) {
        if (body.probe) return json({ source: 'euka', store: store.name, products: [] }, 200, req);
        const auth = index.ownerOf.get(store.id);
        if (auth) {
          const brandId = await storeBrandPair(auth, store.id, store.name);
          if (brandId) {
            const askEuka = () => fetch(`${EUKA_V1}/dashboard/products-performance`, {
              method: 'POST',
              headers: { ...auth, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                brandId,
                postedDateRange: { start: iso(from), end: iso(to) },
                /* 100 IS THEIR CEILING, and 200 is a 400 rather than a
                   truncated page — the same trap as Reacher's page_size. */
                pageSize: 100,
                sortField: 'gmv',
                sortOrder: 'DESC',
              }),
              signal: AbortSignal.timeout(30_000),
            });

            /* ONE RETRY, AND ONLY ON A 5xx. A momentary blip from EUKA should
               not send somebody to the type-it-yourself fallback and leave the
               brand looking like it has no catalogue. A 4xx is an answer and
               asking again would only waste the drawer's time. One retry, not
               three: HoneySticks fails every time, and making a person wait
               twelve seconds to be told the same thing is its own bug. */
            let r = await askEuka();
            if (!r.ok && r.status >= 500) {
              await new Promise((s) => setTimeout(s, 600));
              r = await askEuka();
            }
            if (r.ok) {
              const j = await r.json().catch(() => null) as Record<string, any> | null;
              const rows = (j?.products ?? j?.data?.products ?? j?.data ?? []) as Record<string, any>[];
              const products: Product[] = (Array.isArray(rows) ? rows : []).map((p) => ({
                id: String(p.productId ?? p.product_id ?? p.id ?? ''),
                name: String(p.title ?? p.productName ?? p.name ?? '').trim(),
                image: p.image ?? p.imageUrl ?? p.mainImage ?? null,
                price: p.price != null ? String(p.price) : null,
                status: p.status ?? null,
              })).filter((p) => p.name);

              /*
               * NO PICTURE COMES WITH THIS ANSWER — `products-performance`
               * carries productId, title and twenty figures and no image of
               * any kind — so the pictures are fetched separately, BY ID.
               *
               * The warning that used to live here still stands and is worth
               * keeping: the *list* endpoint `social-intelligence/products` is
               * market-wide, and asked for our own brand id it came back with
               * "medicube US Store" products. A list cannot be trusted. The
               * lookup BY PRODUCT ID can, because the id is ours, and that is
               * what `attachProductImages` uses.
               */
              await attachProductImages(admin, products, {
                store: { auth, brandId },
                market: auth,
                nativeSource: 'euka-social',
              });
              return json({ source: 'euka', store: store.name, products }, 200, req);
            }
            /*
             * SAY WHAT HAPPENED IN WORDS SOMEBODY CAN ACT ON.
             *
             * Rashid, 2026-10-09: "when adding creator for honeysticks,
             * fetching product from euka shows 503 error". It did, and the
             * 503 was EUKA'S, not ours — their catalogue answers 503 for that
             * brand every time while answering normally for Penetrex in the
             * same second, so it is one store on their side, not an outage and
             * not our key. This function was already handling it correctly; it
             * just repeated the number, and the drawer prints the note
             * verbatim, so "Euka answered 503" is what the person onboarding a
             * creator read. That tells them nothing about what to do next.
             *
             * A 5xx is Euka being unable to answer; a 4xx is Euka refusing to.
             * Both end in the same place for the person at the keyboard — type
             * the product — so both say so, and differ only in whether it is
             * worth trying again later.
             */
            const theirFault = r.status >= 500;
            return json({
              source: 'euka',
              store: store.name,
              products: [],
              note: theirFault
                ? `EUKA’s catalogue is not answering for ${store.name} right now (their error ${r.status}). Type the product name and press Enter — you can carry on without it.`
                : `EUKA will not return a catalogue for ${store.name} (error ${r.status}). Type the product name and press Enter.`,
              upstreamStatus: r.status,
            }, 200, req);
          }
          return json({ source: 'euka', store: store.name, products: [], note: 'Euka has no brand id for this store' }, 200, req);
        }
      }
    }
  } catch (e) {
    /* Euka failing is not the end: the brand may be a Reacher one. Fall
       through, and say so in the note if nothing answers. */
    console.error('euka products', String((e as Error).message).slice(0, 200));
  }

  /* ── 2. Reacher, for the brands Euka has no store for ────────────────── */
  try {
    if (reacherKey()) {
      const all = await reacherShops();
      const shop = all.find((s) => norm(s.shop_name) === norm(brand))
        ?? all.find((s) => norm(s.shop_name).includes(norm(brand)) || norm(brand).includes(norm(s.shop_name)));
      if (shop) {
        if (body.probe) return json({ source: 'reacher', store: shop.shop_name, products: [] }, 200, req);
        const full = await findShop(shop.shop_name);
        const j = await reacherRead('/products/catalog', full.shop_id, { page: 1, page_size: 100 });
        const rows = (j.data ?? []) as Record<string, any>[];
        /*
         * THEIR CATALOGUE CAN BE EMPTY WHILE THE SHOP IS BUSY. On Irwin it
         * returns nothing, as `/creators/list` does — that side of their sync
         * is not populated for this shop — while `/videos/list` returns 207
         * real videos, and every one of them carries the product it promotes,
         * with TikTok's own product id.
         *
         * So the fallback is not a guess: it is the same products, counted
         * from the work that was actually posted, and ordered by how much of
         * it there was. An empty picker would send whoever is onboarding back
         * to typing the name by hand, which is the thing being replaced.
         */
        if (!rows.length) {
          const vids = await reacherRead('/videos/list', full.shop_id, {
            page: 1, page_size: 100, start_date: iso(from), end_date: iso(to),
          });
          const tally = new Map<string, { name: string; n: number }>();
          for (const v of (vids.data ?? []) as Record<string, any>[]) {
            const id = String(v.product_id ?? '').trim();
            const name = String(v.product_name ?? '').trim();
            if (!name) continue;
            const key = id || name.toLowerCase();
            const seen = tally.get(key);
            tally.set(key, { name, n: (seen?.n ?? 0) + 1 });
          }
          const derived: Product[] = [...tally.entries()]
            .sort((a, b) => b[1].n - a[1].n)
            .map(([id, t]) => ({ id, name: t.name, image: null, price: null, status: null }));
          /* These ids came off Reacher's videos, but they are TIKTOK product
             ids, so the market lookup can picture them even though this brand
             has no EUKA store and no EUKA brand id anywhere. */
          await attachProductImages(admin, derived, { market: marketAuth() });
          return json({
            source: 'reacher',
            store: full.shop_name,
            products: derived,
            note: derived.length
              ? 'Reacher holds no product catalogue for this shop, so these are the products its videos promote, commonest first'
              : 'Reacher has neither a catalogue nor any videos for this shop',
          }, 200, req);
        }
        const products: Product[] = rows.map((p) => ({
          id: String(p.product_id ?? ''),
          name: String(p.title ?? p.product_name ?? '').trim(),
          image: p.primary_image_url ?? (Array.isArray(p.image_urls) ? p.image_urls[0] : null) ?? null,
          /* Their prices are in cents, and a range when the SKUs differ. */
          price: p.price_min_cents != null
            ? `${(Number(p.price_min_cents) / 100).toFixed(2)}${p.price_max_cents != null && p.price_max_cents !== p.price_min_cents ? `–${(Number(p.price_max_cents) / 100).toFixed(2)}` : ''}`
            : null,
          status: p.product_status ?? null,
        })).filter((p) => p.name);
        /* Their own catalogue picture wins where there is one; the rest fall
           through to the market lookup by the same TikTok product id. */
        await attachProductImages(admin, products, { market: marketAuth(), nativeSource: 'reacher' });
        return json({ source: 'reacher', store: full.shop_name, products }, 200, req);
      }
    }
  } catch (e) {
    return json({ source: 'reacher', products: [], note: String((e as Error).message).slice(0, 200) }, 200, req);
  }

  /*
   * NEITHER PLATFORM KNOWS THIS BRAND, which is a fact and not an error: most
   * of the 43 brands on Paid Collabs have no store on either. The modal falls
   * back to the brand's own focus products and free typing, exactly as before.
   */
  return json({ source: 'none', products: [], note: `No Euka store or Reacher shop is called "${brand}"` }, 200, req);
});
