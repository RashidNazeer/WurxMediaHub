/**
 * WHAT THE VIDEOS A CREATOR POSTED FOR A BRAND HAVE MADE, over a month or any range of days.
 *
 * Rashid, 2026-11-06: pick October and see the GMV the videos posted in October have
 * made in total, on today's date. It is live and never locked: those videos keep
 * selling. Shown in the Brand GMV column of the Creators and Brands tables.
 *
 * THE FIGURE: every video she posted for that brand inside the range, each counted
 * ONCE, at its GMV so far, across ALL of her rows for the brand. With no range (All
 * Time) it is every video she has ever posted for the brand.
 *
 * WHERE THE GMV COMES FROM: each video's `revenue` is its lifetime GMV as the Euka and
 * Reacher syncs last reported it, so a video from three months ago is in the data and
 * keeps growing. Nothing else is fetched.
 *
 * WHY ACROSS ALL HER ROWS, AND NOT THE ROW ON SCREEN. The Creators table has one row
 * per DEAL, and a deal belongs to the month it was signed. A creator hired in
 * September who posts in October has her October videos on a September row, which is
 * not in October's list at all; and a video that sits on two of her rows is counted
 * twice by any per-row sum. Both were measured on the live data.
 *
 * THE RULES, each one the app's own so this cannot disagree with the brand cards:
 *   - a person is the trimmed, lower-cased name (the key the Creators tab already
 *     uses); a brand is the trimmed name, compared as written;
 *   - a video is its TikTok id (`/video/<digits>`), or its link when it has none;
 *   - where rows disagree about one video the LARGER figure wins, because a video's
 *     GMV only grows, so the larger is the newer sync;
 *   - GMV is the video's `revenue`, never negative, and not rounded here: round once,
 *     where it is shown.
 *
 * A video with NO posted date is left out when there is a range, because it cannot be
 * placed in one. With no range every video counts.
 *
 * THREE KINDS OF VIDEO ARE KEPT APART, because a zero is not a gap: WITH SALES
 * (revenue above 0), ZERO (synced and sold nothing) and UNSYNCED (no revenue figure
 * at all, which is "not reported" and must never be read as $0).
 */

export type VideoEntry = { video?: unknown; date?: unknown; revenue?: unknown };
export type CreatorRow = { name?: unknown; brand?: unknown; video_codes?: unknown };
export type DayRange = { from: string; to: string } | null;

export interface CreatorBrandGmv {
  brand: string;
  creatorKey: string;
  creatorName: string;
  /** Distinct videos posted in the range. */
  videos: number;
  /** Of those, how many have sales (revenue above 0). */
  withSales: number;
  /** Synced, and sold nothing. */
  zero: number;
  /** No revenue figure at all: not reported. */
  unsynced: number;
  /** Their GMV so far, unrounded. */
  gmv: number;
}

export const personKey = (name: unknown): string => String(name ?? '').trim().toLowerCase();
const brandName = (brand: unknown): string => String(brand ?? '').trim();

/** The map key for one creator at one brand. */
export const gmvKey = (brand: unknown, name: unknown): string =>
  `${brandName(brand)}\u0000${personKey(name)}`;

/** `/video/<digits>`, the same id the app's totals and the ad figures use. */
function videoId(url: string): string {
  const m = /\/video\/(\d+)/.exec(url);
  return m?.[1] ?? '';
}

/** `YYYY-MM-DD` when the entry has a plain day, otherwise ''. The sync only ever stores that shape. */
function postedDay(entry: VideoEntry): string {
  const raw = String(entry.date ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : '';
}

/** A revenue figure, or null when the entry has none. A numeric string counts: older rows hold some. */
function revenueOf(entry: VideoEntry): number | null {
  const v = entry.revenue;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

interface Seen {
  day: string;
  revenue: number | null;
}

/**
 * Every creator-at-a-brand over `range` (or all time when it is null), with the GMV of
 * the videos posted in it worked out across all of her rows.
 */
export function creatorBrandGmv(rows: CreatorRow[], range: DayRange): Map<string, CreatorBrandGmv> {
  /* group the entries by person and brand first, then dedupe within the group */
  const groups = new Map<
    string,
    { brand: string; creatorKey: string; creatorName: string; videos: Map<string, Seen> }
  >();

  for (const c of rows ?? []) {
    const brand = brandName(c?.brand);
    const creatorKey = personKey(c?.name);
    if (!brand || !creatorKey) continue;
    const list = Array.isArray(c?.video_codes) ? (c.video_codes as VideoEntry[]) : [];
    if (!list.length) continue;

    const k = `${brand}\u0000${creatorKey}`;
    let g = groups.get(k);
    if (!g) {
      g = { brand, creatorKey, creatorName: String(c?.name ?? '').trim(), videos: new Map() };
      groups.set(k, g);
    } else {
      /* the same name can be spelled with different case or spacing across rows; keep the smallest */
      const n = String(c?.name ?? '').trim();
      if (n && n < g.creatorName) g.creatorName = n;
    }

    for (const entry of list) {
      const url = String((entry as VideoEntry)?.video ?? '').trim();
      if (!url) continue;
      const day = postedDay(entry);
      if (range && !day) continue; // cannot be placed in a range
      const key = videoId(url) || url;
      const revenue = revenueOf(entry);
      const cur = g.videos.get(key);
      if (!cur) {
        g.videos.set(key, { day, revenue });
      } else {
        /* the earliest day, and the larger figure (null only if no row had one) */
        if (day && (!cur.day || day < cur.day)) cur.day = day;
        if (revenue !== null && (cur.revenue === null || revenue > cur.revenue)) cur.revenue = revenue;
      }
    }
  }

  const out = new Map<string, CreatorBrandGmv>();
  for (const g of groups.values()) {
    let videos = 0;
    let withSales = 0;
    let zero = 0;
    let unsynced = 0;
    let gmv = 0;
    for (const v of g.videos.values()) {
      if (range && !(v.day >= range.from && v.day <= range.to)) continue;
      videos += 1;
      if (v.revenue === null) unsynced += 1;
      else if (v.revenue > 0) withSales += 1;
      else zero += 1;
      gmv += Math.max(v.revenue ?? 0, 0);
    }
    if (!videos) continue;
    out.set(gmvKey(g.brand, g.creatorKey), {
      brand: g.brand,
      creatorKey: g.creatorKey,
      creatorName: g.creatorName,
      videos,
      withSales,
      zero,
      unsynced,
      gmv,
    });
  }
  return out;
}
