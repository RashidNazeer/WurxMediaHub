import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { PerformanceWindow } from './usePerformance';

/**
 * THE PERIOD AND BRAND EVERY CREATOR SCREEN SHARES, held in the URL.
 *
 * Home and My numbers must agree, and §6 asks for exactly that: "shared state
 * in the URL search params, so a link opens the same view". Putting it in the
 * address bar rather than in a context gets three things at once — the back
 * button works, a link she sends to support opens what she was looking at, and
 * a reload does not silently reset her to the default period.
 *
 * `?period=7|30|90|custom`, `?from=&to=` when custom, `?brand=<id>`.
 */

const DAY = 24 * 60 * 60 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export type PeriodKey = '7' | '30' | '90' | 'custom';

/**
 * 30 DAYS IS THE DEFAULT, and that is a change worth naming.
 *
 * The old range helper in `usePerformance.ts` (since removed) defaulted to ALL TIME, with a good
 * reason recorded: "a video that ran last month would show a flat zero under
 * month-to-date, and a creator seeing zero against work they know sold is the
 * fastest way to lose their trust in every other number on the screen."
 *
 * The redesign asks for 30D, and the old reason does not quite apply to it: a
 * rolling 30 days is not month-to-date, so a video from three weeks ago is
 * still inside it. But the danger is real for a creator whose last video was
 * two months ago, so the screens that use this ALSO offer a way out — when a
 * period is empty and all-time is not, they say so and link to it. The fix for
 * "zero is frightening" is an explanation, not a wider default.
 */
const DEFAULT_PERIOD: PeriodKey = '30';

export interface CreatorPeriod {
  key: PeriodKey;
  /** The selected window, clamped to days we actually hold. */
  from: string | null;
  to: string | null;
  /** The same number of days immediately before `from`, for "vs previous". */
  prevFrom: string | null;
  prevTo: string | null;
  /** How many days the window covers, once clamped. */
  days: number;
  /** A brand id, or null for every brand. */
  brandId: string | null;
  label: string;
  setPeriod: (key: PeriodKey, custom?: { from: string; to: string }) => void;
  setBrand: (brandId: string | null) => void;
}

export function useCreatorPeriod(window: PerformanceWindow | undefined): CreatorPeriod {
  const [params, setParams] = useSearchParams();

  const key = (params.get('period') as PeriodKey | null) ?? DEFAULT_PERIOD;
  const brandId = params.get('brand');
  const customFrom = params.get('from');
  const customTo = params.get('to');

  const resolved = useMemo(() => {
    if (!window?.earliest) return { from: null, to: null, prevFrom: null, prevTo: null, days: 0 };

    /* THE CEILING IS YESTERDAY. Today is still accruing and we do not store
       it; a half-written day beside complete ones makes the last point of
       every chart look like a collapse. */
    const yesterday = iso(new Date(Date.now() - DAY));
    const ceiling = window.latest && window.latest < yesterday ? window.latest : yesterday;

    let from: string;
    let to: string;

    if (key === 'custom' && customFrom && customTo) {
      from = customFrom;
      to = customTo > ceiling ? ceiling : customTo;
    } else {
      const back = Number(key === 'custom' ? DEFAULT_PERIOD : key);
      to = ceiling;
      from = iso(new Date(new Date(`${to}T00:00:00Z`).getTime() - (back - 1) * DAY));
    }

    /* THE PREVIOUS PERIOD IS MEASURED BEFORE CLAMPING, deliberately.
       Clamp first and a creator whose history starts mid-window gets a short
       "previous" compared against a full current one, which reads as a crash
       that never happened. The comparison is only offered when the earlier
       window is genuinely covered by data we hold. */
    const span = Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / DAY + 1
    );
    const prevTo = iso(new Date(new Date(`${from}T00:00:00Z`).getTime() - DAY));
    const prevFrom = iso(new Date(new Date(`${prevTo}T00:00:00Z`).getTime() - (span - 1) * DAY));
    const havePrev = window.earliest <= prevFrom;

    /* The floor is the day her first video existed. Never earlier: an empty
       stretch before the video was posted reads as "you earned nothing". */
    const clampedFrom = from < window.earliest ? window.earliest : from;
    const days = Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${clampedFrom}T00:00:00Z`).getTime()) /
        DAY +
        1
    );

    return {
      from: clampedFrom,
      to,
      prevFrom: havePrev ? prevFrom : null,
      prevTo: havePrev ? prevTo : null,
      days,
    };
  }, [key, customFrom, customTo, window?.earliest, window?.latest]);

  const setPeriod = useCallback(
    (next: PeriodKey, custom?: { from: string; to: string }) => {
      const p = new URLSearchParams(params);
      p.set('period', next);
      if (next === 'custom' && custom) {
        p.set('from', custom.from);
        p.set('to', custom.to);
      } else {
        p.delete('from');
        p.delete('to');
      }
      /* `replace` so flipping 7D/30D/90D does not stack ten history entries
         between her and the page she came from. */
      setParams(p, { replace: true });
    },
    [params, setParams]
  );

  const setBrand = useCallback(
    (next: string | null) => {
      const p = new URLSearchParams(params);
      if (next) p.set('brand', next);
      else p.delete('brand');
      setParams(p, { replace: true });
    },
    [params, setParams]
  );

  const label =
    key === 'custom'
      ? customFrom && customTo
        ? `${customFrom} to ${customTo}`
        : 'Custom'
      : `${key}D`;

  return { key, ...resolved, brandId, label, setPeriod, setBrand };
}
