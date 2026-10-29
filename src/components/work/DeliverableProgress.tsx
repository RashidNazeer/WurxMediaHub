import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * How far somebody has got towards one contest deliverable.
 *
 * THE ENCODING, and it is the whole point of this component:
 *
 *   confirmed   --wx-stage-paid   the team has checked it. It counts. It pays.
 *   claimed     --wx-stage-due    typed by the creator, not yet confirmed.
 *   still to go  surface          nothing is known about it.
 *
 * Those are the three tokens this product reserves for where work and money have
 * got to, which is exactly what this is, so nothing here invents a colour and
 * nothing here can fail the contrast guard.
 *
 * The distinction between confirmed and claimed is not decoration. A creator
 * types their own GMV, so an unconfirmed figure is a claim about money. Drawing
 * the two the same way would tell somebody they had earned something nobody has
 * agreed to, which is the one lie this feature must not tell.
 *
 * Colour never carries meaning alone: every state is also named in the legend
 * underneath and in the accessible label, so this reads correctly in greyscale,
 * to a screen reader, and to somebody who cannot separate the bar colours.
 */

export type DeliverableType = 'gmv' | 'video_count';

interface DeliverableProgressProps {
  type: DeliverableType;
  /** What the admin set. Read only, always, everywhere. */
  target: number;
  /** Checked by the team. This is the only figure money may be owed against. */
  confirmed: number;
  /** Typed by the creator and not yet checked. Never counted as earned. */
  claimed: number;
  /** For a GMV target, so a figure reads as money rather than as a bare number. */
  currency?: string;
  /** What this deliverable pays, if it is worth showing here. */
  reward?: number | null;
  title: string;
  className?: string;
}

const fmt = (n: number, type: DeliverableType, currency?: string) => {
  if (type === 'video_count') return `${Math.round(n)}`;
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
    maximumFractionDigits: 0,
  }).format(n);
};

const unit = (type: DeliverableType, n: number) =>
  type === 'video_count' ? (n === 1 ? 'video' : 'videos') : 'GMV';

export function DeliverableProgress({
  type,
  target,
  confirmed,
  claimed,
  currency,
  reward,
  title,
  className,
}: DeliverableProgressProps) {
  const labelId = useId();

  // Claimed is a CUMULATIVE total that includes whatever is already confirmed,
  // so the claimed band is the part beyond it rather than the whole claim. Without
  // this the two would overlap and the bar would read past 100 percent.
  const safeTarget = target > 0 ? target : 0;
  const confirmedShare = safeTarget ? Math.min(1, confirmed / safeTarget) : 0;
  const claimedShare = safeTarget ? Math.min(1, Math.max(claimed, confirmed) / safeTarget) : 0;
  const pendingShare = Math.max(0, claimedShare - confirmedShare);

  const done = safeTarget > 0 && confirmed >= safeTarget;
  const awaiting = pendingShare > 0;

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span id={labelId} className="text-text text-[0.875rem] font-semibold">
          {title}
        </span>
        <span className="text-muted font-mono text-[0.75rem]">
          {/* The confirmed figure leads, because it is the true one. */}
          <span className={cn('font-semibold', done ? 'text-stage-paid' : 'text-text')}>
            {fmt(confirmed, type, currency)}
          </span>
          <span aria-hidden> / </span>
          <span className="sr-only"> of a target of </span>
          {fmt(safeTarget, type, currency)} {unit(type, safeTarget)}
        </span>
      </div>

      {/*
        The track. role=img with one sentence rather than a progressbar role,
        because there are two values here and a progressbar can only announce
        one, which would silently drop the unconfirmed half.
      */}
      <div
        role="img"
        aria-labelledby={labelId}
        aria-label={
          `${title}. ${fmt(confirmed, type, currency)} confirmed of ` +
          `${fmt(safeTarget, type, currency)}${
            awaiting
              ? `, plus ${fmt(claimed - confirmed, type, currency)} waiting to be confirmed`
              : ''
          }.`
        }
        className="bg-surface-3 relative h-2.5 w-full overflow-hidden rounded-full"
      >
        {/* Confirmed. Rounded at its leading end, flush at the baseline. */}
        {confirmedShare > 0 ? (
          <div
            className="bg-stage-paid absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${confirmedShare * 100}%` }}
          />
        ) : null}

        {/*
          Claimed, sitting beyond it, with a 2px gap in the surface colour so the
          two bands never read as one continuous fill.
        */}
        {pendingShare > 0 ? (
          <div
            className="bg-stage-due absolute inset-y-0 rounded-full"
            style={{
              left: `calc(${confirmedShare * 100}% + 2px)`,
              width: `calc(${pendingShare * 100}% - 2px)`,
            }}
          />
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {awaiting ? (
          <span className="text-muted inline-flex items-center gap-1.5 text-[0.75rem]">
            <span className="bg-stage-due size-2 rounded-full" aria-hidden />
            {fmt(claimed - confirmed, type, currency)} waiting to be confirmed
          </span>
        ) : null}

        {done ? (
          <span className="text-stage-paid inline-flex items-center gap-1.5 text-[0.75rem] font-semibold">
            <span className="bg-stage-paid size-2 rounded-full" aria-hidden />
            Target reached
          </span>
        ) : null}

        {typeof reward === 'number' ? (
          <span className="text-muted ml-auto font-mono text-[0.75rem]">
            {new Intl.NumberFormat('en-GB', {
              style: 'currency',
              currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : 'USD',
              maximumFractionDigits: 0,
            }).format(reward)}{' '}
            when reached
          </span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The same three states as a ring, for one headline deliverable.
 *
 * A donut rather than a bar only where there is ONE number worth looking at.
 * Several deliverables side by side are bars, because comparing arc lengths is
 * something people are measurably bad at and comparing bar lengths is not.
 */
export function DeliverableDonut({
  type,
  target,
  confirmed,
  claimed,
  currency,
  size = 132,
}: Omit<DeliverableProgressProps, 'title' | 'className' | 'reward'> & { size?: number }) {
  const safeTarget = target > 0 ? target : 0;
  const confirmedShare = safeTarget ? Math.min(1, confirmed / safeTarget) : 0;
  const claimedShare = safeTarget ? Math.min(1, Math.max(claimed, confirmed) / safeTarget) : 0;
  const pendingShare = Math.max(0, claimedShare - confirmedShare);

  const stroke = 12;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  // A 2px gap in the surface colour, expressed as a fraction of the ring, so the
  // two arcs never touch. Same rule as the bar.
  const gap = pendingShare > 0 ? 2 / c : 0;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`${Math.round(confirmedShare * 100)} percent confirmed${
        pendingShare > 0
          ? `, ${Math.round(pendingShare * 100)} percent waiting to be confirmed`
          : ''
      }`}
      className="shrink-0"
    >
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-3"
        />
        {pendingShare > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            className="stroke-stage-due"
            strokeDasharray={`${Math.max(0, (claimedShare - gap) * c)} ${c}`}
          />
        ) : null}
        {confirmedShare > 0 ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            className="stroke-stage-paid"
            strokeDasharray={`${confirmedShare * c} ${c}`}
          />
        ) : null}
      </g>

      <text
        x="50%"
        y="50%"
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-text font-display text-[1.375rem] font-bold"
      >
        {Math.round(confirmedShare * 100)}%
      </text>
      <text
        x="50%"
        y="50%"
        dy="1.5em"
        dominantBaseline="middle"
        textAnchor="middle"
        className="fill-muted text-[0.625rem] font-semibold tracking-[0.14em] uppercase"
      >
        {fmt(confirmed, type, currency)}
      </text>
    </svg>
  );
}
