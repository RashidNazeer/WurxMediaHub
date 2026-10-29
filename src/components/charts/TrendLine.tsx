import { useId } from 'react';
import { cn } from '@/lib/utils';
import {
  allMissing,
  areaPaths,
  compact,
  compactMoney,
  exactMoney,
  linePaths,
  maxOf,
  niceTicks,
  NOT_REPORTED,
  scale,
  useChartBox,
  useChartHover,
  type ChartPoint,
} from './chart-kit';
import { ChartTip } from './ChartTip';

/**
 * THE FULL DAY-BY-DAY VIEW: a line with gridlines, axis labels and a crosshair.
 *
 * Detail views only. Home's small widgets use the spark charts; this is what
 * opens behind them.
 *
 * ---------------------------------------------------------------------------
 * ABOUT THE SECOND SCALE, because this is the one place the design, this
 * repo's own code and the charting rules disagree.
 *
 * The build prompt (§5.1c) asks for "ad spend drawn as faint bars behind it on
 * a second scale". the since-deleted `PerformanceChart.tsx` argued the opposite, in
 * its own words: *"A second y-axis would let any two lines be drawn to cross
 * wherever the scaling happened to put them, which is the single most
 * misleading thing a chart can do."* The general rule agrees with the code.
 *
 * Both are right about different things. GMV and ad spend are the same
 * currency, so they CAN share an axis — but spend is routinely a fortieth of
 * GMV ($1,840 against $42.8K in the reference), and on a shared axis the bars
 * flatten into the baseline and tell nobody anything.
 *
 * So: `spendScale` defaults to `shared` — honest comparison, both in the same
 * money. `own` is available because the design asks for it and because the
 * question it answers is about SHAPE ("did ads lift sales"), not magnitude.
 * When it is used the right-hand axis is drawn and labelled with its own
 * maximum, so the second scale is stated rather than hidden. An unlabelled
 * second axis is the misleading thing; a labelled one is a convention.
 * ---------------------------------------------------------------------------
 */
export function TrendLine({
  data,
  spend,
  currency = null,
  ariaLabel,
  token = '--chart-1',
  spendToken = '--chart-3',
  spendScale = 'shared',
  money = true,
  height = '13.75rem',
  className,
  lineLabel = 'GMV',
  spendLabel = 'Ad spend',
}: {
  data: ChartPoint[];
  /** Optional bars behind the line. Same days, same order. */
  spend?: ChartPoint[];
  currency?: string | null;
  ariaLabel: string;
  token?: string;
  spendToken?: string;
  /** See the note above. `own` draws and labels a second axis. */
  spendScale?: 'shared' | 'own';
  money?: boolean;
  height?: string;
  className?: string;
  lineLabel?: string;
  spendLabel?: string;
}) {
  const [ref, box] = useChartBox();
  const { at, setAt, svgRef, onMove } = useChartHover(data.length);
  const gid = useId().replace(/:/g, '');

  const stroke = Math.max(1, 0.125 * box.rem);
  const padL = 3 * box.rem;
  const padR = box.rem;
  const padT = 0.75 * box.rem;
  const padB = 1.5 * box.rem;
  const plotW = Math.max(0, box.w - padL - padR);
  const plotH = Math.max(0, box.h - padT - padB);

  const lineMax = maxOf(data);
  const spendMax = spend ? maxOf(spend) : 0;
  const rawMax = spendScale === 'shared' && spend ? Math.max(lineMax, spendMax) : lineMax;
  /* The scale ends on a round number, and the gridlines sit on round numbers
     up to it. See `niceTicks`. */
  const axis = niceTicks(rawMax, 4);
  const yMax = axis.top;

  const x = scale([0, Math.max(1, data.length - 1)], [padL, padL + plotW]);
  const y = scale([0, yMax || 1], [padT + plotH, padT]);
  const ySpend = scale(
    [0, (spendScale === 'own' ? spendMax : yMax) || 1],
    [padT + plotH, padT]
  );

  const pts = data.map((p, i) => ({ x: x(i), y: p.value === null ? null : y(p.value) }));
  const ticks = axis.ticks;
  const empty = allMissing(data);

  /* Four labels at most across the foot, or they collide at phone width. */
  const labelEvery = Math.max(1, Math.ceil(data.length / 4));
  const slot = data.length > 1 ? plotW / (data.length - 1) : plotW;
  /* A SEVEN-DAY CHART IS MOSTLY EMPTY SPACE, so the old 0.75rem cap drew
     hairlines marooned in it. The bar takes a share of its own slot and is
     only capped generously, so few days read as broad columns and thirty days
     still read as a comb. */
  const barW = Math.max(2, Math.min(slot * 0.55, 2.25 * box.rem));

  const shownDay = at === null ? null : data[at];
  const shownSpend = at === null || !spend ? null : spend[at];

  return (
    /* TWO BOXES, NOT ONE. The measured box has the fixed `rem` height the
       chart draws into; the caption is its SIBLING. With the caption inside
       the fixed box it simply fell out of the bottom of the panel. */
    <div className={cn('w-full', className)}>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {empty ? (
        <div className="text-faint flex h-full items-center justify-center text-xs">
          {NOT_REPORTED} for this period
        </div>
      ) : (
        box.w > 0 && (
          <svg
            ref={svgRef}
            width={box.w}
            height={box.h}
            role="img"
            aria-label={ariaLabel}
            className="block touch-pan-y"
            onPointerMove={(e) => onMove(e, padL, padL + plotW)}
            onPointerLeave={() => setAt(null)}
          >
            <defs>
              <linearGradient id={`t${gid}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: `var(${token})`, stopOpacity: 0.15 }} />
                <stop offset="100%" style={{ stopColor: `var(${token})`, stopOpacity: 0 }} />
              </linearGradient>
            </defs>

            {/* Gridlines, recessive by design: they orient, they do not compete. */}
            {ticks.map((t, i) => (
              <g key={i}>
                <line
                  x1={padL}
                  x2={padL + plotW}
                  y1={y(t)}
                  y2={y(t)}
                  strokeWidth={1}
                  style={{ stroke: 'var(--chart-grid)' }}
                />
                <text
                  x={padL - 0.5 * box.rem}
                  y={y(t) + 0.25 * box.rem}
                  textAnchor="end"
                  className="tabular-nums"
                  style={{ fill: 'var(--chart-muted)', fontSize: 0.625 * box.rem }}
                >
                  {money ? compactMoney(t, currency) : compact(t)}
                </text>
              </g>
            ))}

            {/* Spend bars sit BEHIND the line: context, not the subject. */}
            {spend?.map((p, i) =>
              p.value === null ? null : (
                <rect
                  key={`s${i}`}
                  x={x(i) - barW / 2}
                  y={ySpend(p.value)}
                  width={barW}
                  height={Math.max(1, padT + plotH - ySpend(p.value))}
                  rx={Math.min(barW / 2, 0.125 * box.rem)}
                  style={{ fill: `var(${spendToken})`, opacity: 0.35 }}
                />
              )
            )}

            {areaPaths(pts, padT + plotH).map((d, i) => (
              <path key={`a${i}`} d={d} fill={`url(#t${gid})`} />
            ))}
            {linePaths(pts).map((d, i) => (
              <path
                key={`l${i}`}
                d={d}
                fill="none"
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ stroke: `var(${token})` }}
              />
            ))}

            {/* POINTS, WHEN THERE ARE FEW OF THEM. Seven values joined across a
                wide box read as a straight ramp; the dots say where the
                measurements actually are and where the line is interpolating
                between them. Above ~14 days they would crowd the line, so they
                stop. */}
            {data.length <= 14 &&
              data.map((p, i) =>
                p.value === null ? null : (
                  <circle
                    key={`pt${i}`}
                    cx={x(i)}
                    cy={y(p.value)}
                    r={stroke * 1.15}
                    style={{ fill: `var(${token})` }}
                  />
                )
              )}

            {/* The crosshair: 1px, dashed, quiet. */}
            {at !== null && (
              <>
                <line
                  x1={x(at)}
                  x2={x(at)}
                  y1={padT}
                  y2={padT + plotH}
                  strokeWidth={1}
                  strokeDasharray="3 3"
                  style={{ stroke: 'var(--chart-muted)', opacity: 0.6 }}
                />
                {shownDay != null && shownDay.value !== null && (
                  <circle
                    cx={x(at)}
                    cy={y(shownDay.value)}
                    r={stroke * 2}
                    style={{ fill: `var(${token})` }}
                  />
                )}
              </>
            )}

            {/* Day labels along the foot. */}
            {data.map((p, i) =>
              i % labelEvery === 0 || i === data.length - 1 ? (
                <text
                  key={`x${i}`}
                  x={x(i)}
                  y={box.h - 0.25 * box.rem}
                  textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}
                  style={{ fill: 'var(--chart-muted)', fontSize: 0.625 * box.rem }}
                >
                  {p.label}
                </text>
              ) : null
            )}

          </svg>
        )
      )}

      {shownDay && (
          <ChartTip
            x={x(at as number)}
            boxWidth={box.w}
            title={shownDay.label}
            value={`${lineLabel} ${
              shownDay.value === null
                ? NOT_REPORTED
                : money
                  ? exactMoney(shownDay.value, currency)
                  : shownDay.value.toLocaleString()
            }`}
            second={
              shownSpend
                ? `${spendLabel} ${
                    shownSpend.value === null ? NOT_REPORTED : exactMoney(shownSpend.value, currency)
                  }`
                : undefined
            }
          />
        )}
      </div>

      {/*
        THE LEGEND AND THE SECOND SCALE LIVE UNDER THE CHART, not inside it.
        They were drawn as SVG text in the top-right corner and landed on top
        of the line itself at phone width — the one place the line is highest.
        Below the plot they are always readable and never collide with data.
      */}
      {spend && !empty && (
        <div className="text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.625rem]">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0.5 w-3 rounded-full"
              style={{ backgroundColor: `var(${token})` }}
            />
            {lineLabel}
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-1.5 rounded-sm"
              style={{ backgroundColor: `var(${spendToken})`, opacity: 0.5 }}
            />
            {spendLabel}
            {spendScale === 'own' && (
              <span className="tabular-nums">
                {' '}
                &mdash; own scale, to {money ? compactMoney(spendMax, currency) : compact(spendMax)}
              </span>
            )}
          </span>
        </div>
      )}

    </div>
  );
}
