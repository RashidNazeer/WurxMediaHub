import type { PerformanceWindow } from '@/lib/creator/usePerformance';

/**
 * The date range behind "My numbers", as a range rather than a set of tabs.
 *
 * Rashid, 2026-10-07, with a screenshot of a two-month calendar: "the data can
 * be displayed for any date range ... Make it like a calender okay?"
 *
 * NOTHING IN THE DATABASE HAD TO CHANGE FOR THIS. `creator_video_performance`,
 * `creator_daily_performance` and `creator_brand_performance` already take
 * `p_from` and `p_to` as plain dates and filter `between p_from and p_to`,
 * inclusive on both ends. The old screen only ever offered four fixed ranges
 * because the UI chose to, not because the data did.
 *
 * EVERYTHING HERE IS UTC, which is not a detail. A stat date is an AD ACCOUNT's
 * day as TikTok closed it, so it is already a calendar date with no time zone of
 * its own. Building these with `new Date(y, m, d)` would use the browser's local
 * zone, and for anybody east of Greenwich that lands the boundary a day out —
 * which, for this screen, means a day's money filed under the wrong month.
 *
 * THIS FILE IS PURE. No React, no client, no fetching, so the rules below can be
 * read and tested on their own.
 */

/** `YYYY-MM-DD` in UTC. */
export function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** `YYYY-MM` in UTC. */
function ym(d: Date): string {
  return iso(d).slice(0, 7);
}

const DAY = 86_400_000;

export function addDays(date: string, n: number): string {
  return iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY));
}

/** First day of a `YYYY-MM`. */
export function firstOfMonth(key: string): string {
  return `${key}-01`;
}

/** Last day of a `YYYY-MM`, found by stepping back from the next first. */
function lastOfMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return iso(new Date(Date.UTC(y as number, m as number, 1) - DAY));
}

/** Shift a `YYYY-MM` by whole months, without a table of month lengths. */
export function shiftMonthKey(key: string, by: number): string {
  const [y, m] = key.split('-').map(Number);
  return ym(new Date(Date.UTC(y as number, (m as number) - 1 + by, 1)));
}

/** "September 2026", in the viewer's locale but on a UTC date. */
export function monthTitle(key: string): string {
  return new Date(`${firstOfMonth(key)}T00:00:00Z`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "7 Sep 2026", for the button and the range summary. */
export function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * THE LATEST DAY THAT CAN BE ASKED FOR.
 *
 * Yesterday, and never later, because the nightly job only ever writes a day
 * once it is COMPLETE — so today's row does not exist yet and offering it would
 * promise a number that is always zero. Capped again at `window.latest`, so a
 * creator whose last video stopped earning in August cannot select into an empty
 * September and read it as the product losing their money.
 */
function ceilingOf(w: PerformanceWindow | undefined): string {
  const yesterday = iso(new Date(Date.now() - DAY));
  if (!w?.latest) return yesterday;
  return w.latest < yesterday ? w.latest : yesterday;
}

/** The earliest day worth offering: their first video. */
function floorOf(w: PerformanceWindow | undefined): string | null {
  return w?.earliest ?? null;
}

export type PresetKey =
  'all' | '7' | '30' | '90' | '6m' | '12m' | 'thisMonth' | 'lastMonth' | 'prevYear' | 'custom';

/**
 * The shortcuts, in the order they are drawn.
 *
 * SIX OF THESE ARE RASHID'S, from the picker he sent: last 7, 30 and 90 days,
 * last 6 and 12 months, and the previous calendar year. "All time" is kept
 * because it was the screen's default and is the honest answer for a creator
 * with three weeks of history. "This month" and "Last month" are kept because
 * the control they replace was a month walker he asked for by name — "what did
 * I earn in July" — and losing that in a redesign would be a regression dressed
 * as an improvement. Any other month is two clicks on the calendar.
 */
export const PRESETS: { key: Exclude<PresetKey, 'custom'>; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: '7', label: 'Last 7 days' },
  { key: '30', label: 'Last 30 days' },
  { key: '90', label: 'Last 90 days' },
  { key: '6m', label: 'Last 6 months' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'thisMonth', label: 'This month' },
  { key: 'lastMonth', label: 'Last month' },
  { key: 'prevYear', label: 'Previous calendar year' },
];

export type DateRange = { from: string; to: string };

/**
 * A preset to two dates, clamped to what the creator actually has.
 *
 * Returns null only while the window is still loading, which is what keeps the
 * hooks disabled rather than firing a query for a range nobody chose.
 */
export function presetToRange(
  key: Exclude<PresetKey, 'custom'>,
  w: PerformanceWindow | undefined
): DateRange | null {
  const floor = floorOf(w);
  if (!floor) return null;
  const to = ceilingOf(w);
  const back = (n: number) => addDays(to, -(n - 1));

  let from: string;
  let end = to;
  switch (key) {
    case 'all':
      from = floor;
      break;
    case '7':
      from = back(7);
      break;
    case '30':
      from = back(30);
      break;
    case '90':
      from = back(90);
      break;
    /* Whole months back from the month on screen, so "last 6 months" starts on
       a 1st rather than on an arbitrary day 182 days ago. */
    case '6m':
      from = firstOfMonth(shiftMonthKey(to.slice(0, 7), -6));
      break;
    case '12m':
      from = firstOfMonth(shiftMonthKey(to.slice(0, 7), -12));
      break;
    case 'thisMonth':
      from = firstOfMonth(to.slice(0, 7));
      break;
    case 'lastMonth': {
      const k = shiftMonthKey(to.slice(0, 7), -1);
      from = firstOfMonth(k);
      end = lastOfMonth(k);
      break;
    }
    case 'prevYear': {
      const year = Number(to.slice(0, 4)) - 1;
      from = `${year}-01-01`;
      end = `${year}-12-31`;
      break;
    }
  }
  return clamp({ from, to: end }, w);
}

/**
 * Hold a range inside the days that exist.
 *
 * A preset can reach past both ends — "last 12 months" for a creator who joined
 * in August, "previous calendar year" for one who joined this year. Clamping
 * rather than refusing means the shortcut still answers, with everything they
 * have, instead of showing an empty screen for a period they were not here for.
 * Returns null when clamping leaves nothing, which is a real answer: the
 * creator posted nothing in that period.
 */
export function clamp(r: DateRange, w: PerformanceWindow | undefined): DateRange | null {
  const floor = floorOf(w);
  const ceil = ceilingOf(w);
  if (!floor) return null;
  const from = r.from < floor ? floor : r.from;
  const to = r.to > ceil ? ceil : r.to;
  if (from > to) return null;
  return { from, to };
}

/** What the trigger button says. */
export function rangeLabel(preset: PresetKey, range: DateRange | null): string {
  if (!range) return 'All time';
  if (preset !== 'custom') {
    return PRESETS.find((p) => p.key === preset)?.label ?? 'All time';
  }
  if (range.from === range.to) return dayLabel(range.from);
  return `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
}

/**
 * The cells of one month's grid, Sunday first, padded with nulls.
 *
 * Nulls rather than the neighbouring month's days: a leading blank cannot be
 * clicked by mistake, and the two months drawn side by side stay honestly
 * separate instead of sharing dates between their edges.
 */
export function monthCells(key: string): (string | null)[] {
  const first = `${firstOfMonth(key)}T00:00:00Z`;
  const lead = new Date(first).getUTCDay();
  const last = Number(lastOfMonth(key).slice(-2));
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let d = 1; d <= last; d += 1) {
    cells.push(`${key}-${String(d).padStart(2, '0')}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'] as const;
