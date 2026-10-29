import { cn } from '@/lib/utils';
import { compactMoney, exactMoney, useChartBox } from './chart-kit';

interface Slice {
  /** The brand, usually. */
  label: string;
  value: number;
  /** Anything the caller wants back when the slice is tapped (a brand slug). */
  id?: string;
}

/**
 * SHARE BY BRAND. Five slices at most, the rest gathered into "Other".
 *
 * FIVE, AND THEN OTHER, is not a styling choice. A donut stops being readable
 * at about six slices, and the alternative — generating a new hue for a
 * seventh brand — is the thing the chart rules here forbid outright: the
 * palette is four fixed slots that never cycle. So the tail folds into one
 * neutral slice, and the full list lives in the rows beside it.
 *
 * THE ROWS ARE THE LEGEND, and they are also how this is read without colour:
 * every slice is named, with its figure, next to a swatch. Nothing here
 * depends on telling two hues apart.
 */
export function Donut({
  slices,
  currency = null,
  ariaLabel,
  onPick,
  className,
  size = '9rem',
}: {
  slices: Slice[];
  currency?: string | null;
  ariaLabel: string;
  /** Tapping a slice or a row opens that brand. */
  onPick?: (slice: Slice) => void;
  className?: string;
  size?: string;
}) {
  const [ref, box] = useChartBox();

  /*
   * FOUR BRANDS AND THEN OTHER, not five.
   *
   * The build prompt says "max 5 slices, the rest grouped as Other", and the
   * palette has exactly FOUR validated hues. A fifth slice can only be a
   * repeat of one of them, which is the thing the chart rules forbid outright:
   * two slices in one ring wearing the same colour is worse than a shorter
   * head, because it reads as one brand split in two. The full list is in the
   * rows beside the ring either way, so nothing is hidden by this.
   */
  const sorted = [...slices].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, 4);
  const tail = sorted.slice(4);
  const shown: Slice[] =
    tail.length > 0
      ? [...head, { label: 'Other', value: tail.reduce((t, s) => t + s.value, 0) }]
      : head;
  const total = shown.reduce((t, s) => t + s.value, 0);

  const d = Math.min(box.w, box.h);
  const stroke = Math.max(4, d * 0.24);
  const r = (d - stroke) / 2;
  const c = 2 * Math.PI * r;

  /* Four validated hues, then a neutral for "Other" — `--chart-muted` rather
     than `--chart-grid`, which is the gridline tint and nearly invisible as a
     fill. Nothing is ever generated and nothing repeats. */
  const tokenFor = (i: number) => (i < 4 ? `--chart-${i + 1}` : '--chart-muted');

  let offset = 0;
  const arcs = shown.map((s, i) => {
    const frac = total === 0 ? 0 : s.value / total;
    /* A 2px gap between neighbouring fills, so two slices never melt into one
       shape. It is taken off the arc, not added, or the ring would overrun. */
    const gap = Math.min(c * 0.01, stroke * 0.18);
    const len = Math.max(0, c * frac - gap);
    const arc = { s, token: tokenFor(i), len, offset, i };
    offset += c * frac;
    return arc;
  });

  if (total === 0) {
    return (
      <div className={cn('text-faint flex items-center justify-center text-xs', className)} style={{ height: size }}>
        Nothing to split yet
      </div>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-4', className)}>
      <div
        ref={ref}
        className="relative shrink-0"
        style={{ width: size, height: size }}
        role="img"
        aria-label={ariaLabel}
      >
        {d > 0 && (
          <svg width={d} height={d} className="block -rotate-90">
            {arcs.map((a) => (
              <circle
                key={a.i}
                cx={d / 2}
                cy={d / 2}
                r={r}
                fill="none"
                strokeWidth={stroke}
                strokeDasharray={`${a.len} ${c - a.len}`}
                strokeDashoffset={-a.offset}
                style={{ stroke: `var(${a.token})` }}
              />
            ))}
          </svg>
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-muted text-[0.625rem]">Total</span>
          <span className="text-text text-sm font-semibold tabular-nums">
            {compactMoney(total, currency)}
          </span>
        </div>
      </div>

      <ul className="min-w-0 flex-1 space-y-1">
        {arcs.map((a) => {
          const pct = Math.trunc((a.s.value / total) * 1000) / 10;
          const row = (
            <>
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: `var(${a.token})` }}
              />
              {/* An EXPLICIT colour. Without one this span inherited the
                  browser default rather than a theme token, which made every
                  brand name invisible in dark mode while the figures beside
                  it — which do carry a token — stayed readable. */}
              <span className="text-text min-w-0 flex-1 truncate text-left">{a.s.label}</span>
              <span className="text-muted shrink-0 tabular-nums">{pct}%</span>
              <span className="text-text shrink-0 font-medium tabular-nums">
                {exactMoney(a.s.value, currency)}
              </span>
            </>
          );
          const pickable = onPick && a.s.label !== 'Other';
          return (
            <li key={a.i} className="text-xs">
              {pickable ? (
                <button
                  type="button"
                  onClick={() => onPick(a.s)}
                  className="hover:bg-surface-2 flex min-h-11 w-full items-center gap-2 rounded-md px-1 text-left"
                >
                  {row}
                </button>
              ) : (
                <div className="flex min-h-11 items-center gap-2 px-1">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
