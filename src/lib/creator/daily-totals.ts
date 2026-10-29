import { addDays, type DateRange } from '@/lib/creator/date-range';
import type { DailyPerformance } from '@/lib/creator/usePerformance';

/**
 * Adding up daily ad rows, and comparing one window with the one before it.
 *
 * Lifted out of `Dashboard.tsx` when the velocity card needed the same four
 * functions. They are pure, they have no React in them, and two screens doing
 * their own slightly different arithmetic on the same numbers is how a creator
 * ends up seeing two answers to one question.
 */

const DAY_MS = 86_400_000;

const spanDays = (r: DateRange) =>
  Math.round((Date.parse(`${r.to}T00:00:00Z`) - Date.parse(`${r.from}T00:00:00Z`)) / DAY_MS) +
  1;

/**
 * THE WINDOW IMMEDIATELY BEFORE THIS ONE, the same number of days long.
 *
 * Built from `addDays` in date-range.ts, which is UTC throughout, so a window
 * can never be a day out for a creator east of Greenwich. A range that is itself
 * partial (this month, nine days in) is not a special case: the previous window
 * is nine days too, so the two are always like for like.
 */
export function previousWindow(r: DateRange): DateRange {
  const n = spanDays(r);
  return { from: addDays(r.from, -n), to: addDays(r.from, -1) };
}

export function sumDaily(rows: DailyPerformance[]) {
  let cost = 0;
  let revenue = 0;
  let orders = 0;
  for (const r of rows) {
    cost += Number(r.cost);
    revenue += Number(r.gross_revenue);
    orders += Number(r.orders);
  }
  return { cost, revenue, orders, roi: cost > 0 ? revenue / cost : null };
}
