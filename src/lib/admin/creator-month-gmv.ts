/**
 * WHAT A CREATOR MADE FOR A BRAND BETWEEN TWO DATES, as Euka or Reacher report it.
 *
 * Rashid, 2026-11-06: set the date to September and see the GMV the creator made from
 * 1 to 30 September; set it to 1 to 5 November and see those days. By SALES date, from
 * any of her videos: a September sale on a July video counts in September, and an
 * October video's November sales count in November.
 *
 * WHERE THE FIGURES COME FROM, by the dates picked:
 *   a whole calendar month   what `collab-gmv-sync` stored for it (fast)
 *   any other range          asked of the platforms live through the same function
 * and the cell is the same either way.
 *
 * FOUR ANSWERS, because they mean four different things and only one of them is a dash:
 *   a figure    the platform lists her for those dates: that is her GMV
 *   $0          the platform's list for the brand is COMPLETE and she is not on it
 *   under $X    Euka cut its list at 50 creators and she is not on it: she made no more
 *               than the smallest figure it reached. Not $0 and not unknown.
 *   a dash      we hold nothing for that brand and those dates (a brand on neither
 *               platform, or not read yet), or no dates are picked (All Time)
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

export type Period = { from: string; to: string };

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
export function wholeMonthOf(range: Period | null): string | null {
  if (!range) return null;
  const m = /^(\d{4}-\d{2})-01$/.exec(range.from);
  if (!m) return null;
  return range.to === lastDayOf(m[1]!) ? m[1]! : null;
}

/**
 * The stored month a range is answered from, or null when it must be asked live.
 *
 * A whole calendar month, and the month so far (the 1st to TODAY, which is what the page opens
 * on: "This month"), are both answered from what `collab-gmv-sync` stored, so opening the page
 * asks nobody anything. Every other range, like 1 to 5 November, can only have come from the
 * user picking those dates, and is the only thing asked of Euka or Reacher live.
 *
 * The month so far is only today's: 1 to 5 November on the 6th is NOT the month so far, and
 * answering it from a figure that runs to the 6th would be wrong.
 */
export function storedMonthFor(period: Period | null, now: Date): string | null {
  if (!period) return null;
  const whole = wholeMonthOf(period);
  if (whole) return whole;
  const today = now.toISOString().slice(0, 10);
  const cur = today.slice(0, 7);
  return period.from === `${cur}-01` && period.to === today ? cur : null;
}

/** Two real `YYYY-MM-DD` days with the start not after the end, or null. */
export function usablePeriod(range: { from?: string; to?: string } | null | undefined): Period | null {
  const f = range?.from ?? '';
  const t = range?.to ?? '';
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (!day.test(f) || !day.test(t) || f > t) return null;
  if (Number.isNaN(Date.parse(`${f}T00:00:00Z`)) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) return null;
  return { from: f, to: t };
}

const dayText = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "September 2026" for a whole month, "1 Nov 2026 to 5 Nov 2026" for anything else. */
export function periodText(p: Period): string {
  const month = wholeMonthOf(p);
  if (month) {
    const [y, m] = month.split('-').map(Number) as [number, number];
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return p.from === p.to ? dayText(p.from) : `${dayText(p.from)} to ${dayText(p.to)}`;
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const sourceName = (s: 'euka' | 'reacher') => (s === 'euka' ? 'Euka' : 'Reacher');

/**
 * The cell for one row. `meta` is what was read for this row's brand and dates (null: nothing),
 * `byHandle` is handle -> GMV for that brand and those dates.
 */
export function cellFor(
  c: CellRow,
  period: Period | null,
  meta: BrandMonth | null,
  byHandle: Map<string, number> | null,
): GmvCell {
  const brand = String(c?.brand ?? '').trim() || 'this brand';
  if (!period) {
    return {
      label: null,
      gmv: null,
      title: 'Pick a start and an end date to see what she made for this brand between them.',
    };
  }
  const when = periodText(period);
  if (!meta || !byHandle) {
    return {
      label: null,
      gmv: null,
      title: `No Euka or Reacher figures for ${brand} for ${when} (a brand on neither platform, or not read yet).`,
    };
  }
  const via = `${sourceName(meta.source)}, by sales date`;
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
      title: `${money(gmv)} made for ${brand} for ${when} (${via}), from every video she has posted, whenever it was posted.`,
    };
  }
  if (meta.truncated && meta.floorGmv !== null) {
    return {
      label: `< ${money(meta.floorGmv)}`,
      gmv: null,
      title: `Not in ${sourceName(meta.source)}'s top 50 for ${brand} for ${when}, so she made less than ${money(meta.floorGmv)} (${via}).`,
    };
  }
  return {
    label: '$0',
    gmv: 0,
    title: `${sourceName(meta.source)} lists every creator who sold for ${brand} for ${when} and she is not one of them (${via}).`,
  };
}
