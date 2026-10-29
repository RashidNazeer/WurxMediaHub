/**
 * The arithmetic behind Ad Spend and ROI in Paid Collabs.
 *
 * SEPARATE FROM THE REACT FILE ON PURPOSE. Everything here is pure, imports
 * nothing, and reaches no database, which is what lets `pnpm verify:collab-ads`
 * transpile it and test it directly in Node. The rules below are about money on
 * an admin's screen, and "it looked right when I opened the page" is not a way
 * to know they hold.
 */

export type AdFigures = {
  cost: number;
  revenue: number;
  orders: number;
  currency: string | null;
  mixedCurrency: boolean;
};

type AdTotals = {
  cost: number;
  revenue: number;
  orders: number;
  /**
   * REVENUE OVER COST, COMPUTED FROM THE SUMS. Never an average of per-video or
   * per-day ratios: the migration that created `tiktok_video_daily` says it
   * outright, "a ratio cannot be summed", and TikTok's own reported figure
   * agrees only with this version. `null` when cost is zero, because a ratio
   * with no denominator is not zero, it is unanswerable.
   */
  roi: number | null;
  currency: string | null;
  mixedCurrency: boolean;
  /** How many of the videos asked about actually had ad data. */
  withData: number;
  /** How many were asked about at all. */
  asked: number;
};

/**
 * TikTok's numeric id out of a video URL.
 *
 * MIRRORS THE VENDORED APP'S OWN RULE rather than inventing a second one. Their
 * `getTikTokVideoId` matches exactly this, and it is the same number our
 * `tiktok_video_daily.item_id` is keyed on — which is why this join needs no
 * brand-name matching and has no spelling to get wrong.
 */
export function tiktokVideoId(url: unknown): string | null {
  const m = String(url ?? '').match(/\/video\/(\d+)/);
  return m ? (m[1] ?? null) : null;
}

/**
 * The DISTINCT TikTok ids in a creator's `video_codes`.
 *
 * DEDUPED, AND THIS IS ABOUT MONEY RATHER THAN TIDINESS. The vendored app says
 * why where it counts delivery: "the same link can sit in video_codes twice (a
 * bulk paste that overlapped an existing row)". Counting a duplicate twice
 * inflates a delivery count; adding its cost twice inflates a brand's real ad
 * spend, which is a number somebody makes decisions with.
 *
 * Rows without a numeric id are dropped rather than kept as URLs: we can only
 * ever have ad data for a real TikTok video id, so a malformed row is not a
 * video we failed to price, it is not a video.
 */
export function videoIdsOf(videoCodes: unknown): string[] {
  if (!Array.isArray(videoCodes)) return [];
  const seen = new Set<string>();
  for (const row of videoCodes) {
    const id = tiktokVideoId((row as { video?: unknown } | null)?.video);
    if (id) seen.add(id);
  }
  return [...seen];
}

/** Add up whatever we know for a set of videos, and derive ROI from the sums. */
export function totalsOf(get: (id: string) => AdFigures | null, ids: string[]): AdTotals {
  let cost = 0;
  let revenue = 0;
  let orders = 0;
  let withData = 0;
  const currencies = new Set<string>();
  let mixed = false;

  for (const id of ids) {
    const f = get(id);
    if (!f) continue;
    withData += 1;
    cost += f.cost;
    revenue += f.revenue;
    orders += f.orders;
    if (f.currency) currencies.add(f.currency);
    if (f.mixedCurrency) mixed = true;
  }

  return {
    cost,
    revenue,
    orders,
    roi: cost > 0 ? revenue / cost : null,
    currency: currencies.size === 1 ? (currencies.values().next().value ?? null) : null,
    mixedCurrency: mixed || currencies.size > 1,
    withData,
    asked: ids.length,
  };
}

/** `$1,234.56`, or a dash. A dash is never a zero. */
export function money(v: number | null | undefined, currency: string | null): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const code = currency && /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      maximumFractionDigits: v >= 1000 ? 0 : 2,
    }).format(v);
  } catch {
    return v.toFixed(2);
  }
}

/**
 * ROI as TikTok writes it: `3.42x`.
 *
 * A dash when there is no denominator. NOT "0.00x", which reads as "we spent
 * money and got nothing back" when the truth is that nothing was spent at all.
 */
export function roiText(roi: number | null): string {
  if (roi === null || !Number.isFinite(roi)) return '–';
  return `${roi.toFixed(2)}x`;
}
