import { cn } from '@/lib/utils';
import { exactMoney } from './chart-kit';

interface StackPart {
  label: string;
  value: number;
  token: string;
}

/**
 * ONE HORIZONTAL BAR, TWO PARTS. GMV split into ad-backed and organic.
 *
 * ONLY RENDER THIS WHEN THE SPLIT IS REAL. The build prompt is explicit: if the
 * data does not support the split, leave it out rather than guess. The caller
 * decides; this component only refuses an empty total, which would otherwise
 * draw a full-width bar of nothing.
 *
 * A 2px gap separates the parts so two fills never read as one, and each part
 * is named underneath with its figure and share — so the split survives
 * without colour.
 */
export function StackedBar({
  parts,
  currency = null,
  ariaLabel,
  className,
}: {
  parts: StackPart[];
  currency?: string | null;
  ariaLabel: string;
  className?: string;
}) {
  const total = parts.reduce((t, p) => t + Math.max(0, p.value), 0);

  /*
   * THE SHARES MUST SUM TO 100, because they are two halves of one bar.
   *
   * Truncating each independently — the rule everywhere else on a widget face —
   * printed "78% organic, 21.9% ad-backed" under a bar that was visibly full.
   * Two parts of one whole that add up to 99.9 read as a bug, not as caution.
   * So every part but the LAST is truncated as usual, and the last is whatever
   * remains. The money beside each is exact either way, which is the figure
   * that actually matters.
   */
  const shares = parts.map((p) => Math.trunc((Math.max(0, p.value) / (total || 1)) * 1000) / 10);
  const lastIndex = shares.length - 1;
  if (lastIndex >= 0) {
    const head = shares.slice(0, lastIndex).reduce((t, s) => t + s, 0);
    shares[lastIndex] = Math.round((100 - head) * 10) / 10;
  }

  if (total <= 0) return null;

  return (
    <div className={cn('w-full', className)}>
      <div
        role="img"
        aria-label={ariaLabel}
        className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
        style={{ backgroundColor: 'var(--chart-grid)' }}
      >
        {parts.map((p) => (
          <div
            key={p.label}
            style={{
              width: `${(Math.max(0, p.value) / total) * 100}%`,
              backgroundColor: `var(${p.token})`,
            }}
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        {parts.map((p, i) => (
          <li key={p.label} className="text-muted flex items-center gap-1.5 text-[0.6875rem]">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: `var(${p.token})` }}
            />
            <span>{p.label}</span>
            <span className="text-text font-medium tabular-nums">{shares[i]}%</span>
            <span className="tabular-nums">({exactMoney(p.value, currency)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
