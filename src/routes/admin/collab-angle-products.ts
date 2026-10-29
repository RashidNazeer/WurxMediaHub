/**
 * ANGLE → PRODUCT → VIDEOS: the arrangement, with no React in it.
 *
 * Umar, 2026-10-07, pointing at the Brands screen: "there is the product and
 * videos are dropped down linked to it I want this. Under each angle there are
 * products and then under each products there are videos."
 *
 * So an angle is the category and a product is the band inside it, exactly as a
 * brand holds product bands on the Brands screen. A per-video product chip was
 * not that: it told you what one row sold, but you still could not see that an
 * angle's GMV is really one product carrying it and another going nowhere.
 *
 * NOTHING NEW IS FETCHED. The product is already on every video `brandVideos`
 * returns, off `video_codes`, the same field the Brands screen groups by. This
 * only arranges rows that were already on screen.
 *
 * WHY THIS FILE HAS NO JSX. The band component lives next door in
 * `collab-angle-product-band.tsx`. Keeping the arrangement pure means Node can
 * import this file directly -- it strips the types and runs it -- so
 * `scripts/check-angle-products.mjs` tests the real function rather than a
 * second copy of it written to agree with the first. A rule that is only
 * asserted in a comment is a rule nothing enforces.
 *
 * NO SUPABASE CLIENT AND NO PROJECT NAME: the vendored tree imports this, and
 * `pnpm verify:isolation` asserts on every build that it cannot reach our
 * database.
 */

/** What `videoFig` returns, as much of it as the grouping needs. */
interface AngleFig {
  v: { product?: string | null; creator?: string | null } | null;
  views: number;
  gmv: number;
  ad: number;
}

interface AngleVideo {
  url: string;
  f: AngleFig;
}

export interface ProductHead {
  key: string;
  name: string;
  count: number;
  views: number;
  gmv: number;
  ad: number;
  /** True for the one band that collects videos with no product recorded. */
  unknown: boolean;
}

/** A video row, or a product band that introduces the rows under it. */
interface AngleRow {
  url: string;
  f: AngleFig | null;
  wxHead?: ProductHead;
}

export const UNKNOWN_PRODUCT = 'No product recorded';

const nameOf = (x: AngleVideo): string =>
  String((x && x.f && x.f.v && x.f.v.product) || '').trim();

/**
 * The drawer's rows, with a product band before each run of them.
 *
 * BRAND-AGNOSTIC BY CONSTRUCTION. There is no brand in this function and no
 * list of known products: it groups on whatever `product` the rows carry, so a
 * brand added tomorrow behaves exactly as the ones here do today.
 * `scripts/check-angle-products.mjs` enforces that by refusing a brand name
 * anywhere in this file, comments included.
 *
 * COLLAPSING HIDES ROWS, IT DOES NOT CHANGE THE COUNTS. A band always reports
 * what is inside it, shut or open, because a total that moves when you fold a
 * section is a total nobody can trust.
 *
 * A VIDEO WITH NO PRODUCT IS SHOWN, NOT DROPPED, under one honest label and
 * always last -- the rule `wxProductTotals` already follows on the Brands
 * screen. Silently discarding them is how a breakdown stops summing to the
 * angle total above it.
 *
 * WHEN THERE IS NOTHING TO GROUP BY, THERE ARE NO BANDS. If not one video in
 * the angle names a product, bands would be a single row reading "No product
 * recorded" wrapped around the whole list, which is pure noise. The list comes
 * back flat and the drawer looks exactly as it did before.
 */
export function wxAngleRows(shown: AngleVideo[], shut: Set<string>): AngleRow[] {
  const list = Array.isArray(shown) ? shown : [];
  const folded = shut instanceof Set ? shut : new Set<string>();
  if (!list.some((x) => nameOf(x) !== '')) return list as AngleRow[];

  const bands = new Map<string, { head: ProductHead; rows: AngleVideo[] }>();
  for (const x of list) {
    const name = nameOf(x);
    const key = name.toLowerCase();
    let band = bands.get(key);
    if (!band) {
      band = {
        head: {
          key,
          name: name || UNKNOWN_PRODUCT,
          count: 0,
          views: 0,
          gmv: 0,
          ad: 0,
          unknown: name === '',
        },
        rows: [],
      };
      bands.set(key, band);
    }
    band.head.count += 1;
    band.head.views += Number(x.f && x.f.views) || 0;
    band.head.gmv += Number(x.f && x.f.gmv) || 0;
    band.head.ad += Number(x.f && x.f.ad) || 0;
    band.rows.push(x);
  }

  /* Biggest earner first, so the product carrying the angle is the one read
     first; a product with no GMV yet is ordered by how much work went into it.
     The unnamed band is always last whatever its figures, because it is a
     caveat rather than a product. */
  const ordered = [...bands.values()].sort((a, b) => {
    if (a.head.unknown !== b.head.unknown) return a.head.unknown ? 1 : -1;
    return (
      b.head.gmv - a.head.gmv ||
      b.head.count - a.head.count ||
      a.head.name.localeCompare(b.head.name)
    );
  });

  const out: AngleRow[] = [];
  for (const band of ordered) {
    out.push({ url: 'wx-head:' + band.head.key, f: null, wxHead: band.head });
    if (!folded.has(band.head.key)) out.push(...(band.rows as AngleRow[]));
  }
  return out;
}

/** 18452 -> 18.5K, matching the figures already on this screen. */
export function wxCompact(n: number): string {
  const x = Number(n) || 0;
  if (x >= 1000000) return (x / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (x >= 1000) return (x / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(Math.round(x));
}
