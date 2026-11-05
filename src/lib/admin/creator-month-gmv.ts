/**
 * WHAT A CREATOR MADE FOR A BRAND IN A CALENDAR MONTH, as Euka or Reacher report it.
 *
 * Rashid, 2026-11-06: set the date to September and see the GMV the creator made from
 * 1 to 30 September. By SALES date, from any of her videos: a September sale on a July
 * video counts in September. `collab-gmv-sync` copies the platforms' monthly answer into
 * `collab_creator_month_gmv`; this file turns that into what one Creators-table row shows.
 *
 * FOUR ANSWERS, because they mean four different things and only one of them is a dash:
 *   a figure    the platform lists her for that month: that is her GMV
 *   $0          the platform's list for the brand is COMPLETE and she is not on it
 *   under $X    Euka cut its list at 50 creators and she is not on it: she made no more
 *               than the smallest figure it reached. Not $0 and not unknown.
 *   a dash      we hold nothing for that brand and month (a brand on neither platform,
 *               or one not read yet), or the dates are not one whole month
 */

export interface BrandMonth {
  source: 'euka' | 'reacher';
  truncated: boolean;
  floorGmv: number | null;
}

export interface CellRow {
  brand?: unknown;
  tiktok_account?: unknown;
  tiktok_account_2?: unknown;
}

export interface GmvCell {
  /** What to show in the cell, or null for a dash. */
  label: string | null;
  /** The number behind a figure, or null for "under $X" and a dash (a CSV cell is blank for those). */
  gmv: number | null;
  /** The hover text. */
  title: string;
}

/** A TikTok handle however a Paid Collabs row holds it: `@name`, `name`, or a profile link. Lower-case, no @. */
export function handleOf(raw: unknown): string {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return '';
  const last = t.startsWith('http') ? (t.replace(/\/+$/, '').split('/').pop() ?? '') : t;
  return last.replace(/^@+/, '').split(/[?#]/)[0]!.trim();
}

/** The handles on a row, one or two accounts. */
export function rowHandles(c: CellRow): string[] {
  return [...new Set([handleOf(c?.tiktok_account), handleOf(c?.tiktok_account_2)].filter(Boolean))];
}

/** The last day of a `YYYY-MM` month, as `YYYY-MM-DD`. */
function lastDayOf(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

/** `YYYY-MM` when the range is exactly one whole calendar month (first day to last), otherwise null. */
export function wholeMonthOf(range: { from: string; to: string } | null): string | null {
  if (!range) return null;
  const m = /^(\d{4}-\d{2})-01$/.exec(range.from);
  if (!m) return null;
  return range.to === lastDayOf(m[1]!) ? m[1]! : null;
}

export const monthName = (month: string): string => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const sourceName = (s: 'euka' | 'reacher') => (s === 'euka' ? 'Euka' : 'Reacher');

/**
 * The cell for one row. `meta` is what was read for this row's brand and month (null: nothing),
 * `byHandle` is handle -> GMV for that brand and month.
 */
export function cellFor(
  c: CellRow,
  month: string | null,
  meta: BrandMonth | null,
  byHandle: Map<string, number> | null,
): GmvCell {
  const brand = String(c?.brand ?? '').trim() || 'this brand';
  if (!month) {
    return {
      label: null,
      gmv: null,
      title: 'Pick one whole calendar month (1st to the last day) to see what she made for this brand that month.',
    };
  }
  if (!meta || !byHandle) {
    return {
      label: null,
      gmv: null,
      title: `No Euka or Reacher figures for ${brand} in ${monthName(month)} (a brand on neither platform, or not read yet).`,
    };
  }
  const from = `${sourceName(meta.source)}, sales 1 to ${lastDayOf(month).slice(8)} ${monthName(month).split(' ')[0]}`;
  const handles = rowHandles(c);
  if (!handles.length) {
    return { label: null, gmv: null, title: `No TikTok handle on this row, so ${sourceName(meta.source)} cannot be matched to her.` };
  }
  const found = handles.filter((h) => byHandle.has(h));
  if (found.length) {
    const gmv = found.reduce((s, h) => s + (byHandle.get(h) ?? 0), 0);
    return {
      label: money(gmv),
      gmv,
      title: `${money(gmv)} made for ${brand} in ${monthName(month)} (${from}), from every video she has posted, not only that month's.`,
    };
  }
  if (meta.truncated && meta.floorGmv !== null) {
    return {
      label: `< ${money(meta.floorGmv)}`,
      gmv: null,
      title: `Not in ${sourceName(meta.source)}'s top 50 for ${brand} in ${monthName(month)}, so she made less than ${money(meta.floorGmv)} (${from}).`,
    };
  }
  return {
    label: '$0',
    gmv: 0,
    title: `${sourceName(meta.source)} lists every creator who sold for ${brand} in ${monthName(month)} and she is not one of them (${from}).`,
  };
}
