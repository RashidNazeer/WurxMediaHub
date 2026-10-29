import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Crown } from 'lucide-react';
import { m, useReducedMotion } from 'motion/react';
import { FilterTab, FilterTabs } from '@/components/layout/FilterBar';
import { CreatorSearch } from '@/components/creator/SearchField';
import { BrandFilter } from '@/components/creator/BrandFilter';
import { NeoCardSkeleton } from '@/components/brand/NeoSkeleton';
import { CreatorFace } from '@/components/work/CreatorFace';
import type { LeaderboardRow } from '@/lib/creator/useLeaderboard';
import { cn } from '@/lib/utils';
import { RANGES, faceMoney, tipMoney, type BoardItem, type RangeKey } from './board-kit';

/**
 * THE WHOLE PAGE: a phone-width column. Period pills, a podium of three round
 * faces sitting straight on the page (first raised in the centre under a
 * crown, second and third smaller and lower), then one rounded pill per
 * creator from fourth place down.
 *
 * The three places differ by SIZE and by the accent at three strengths (ring
 * and glow), never by medal colour. The glow is a static `box-shadow`: no
 * `filter`, no `backdrop-filter`, nothing animated but transform and opacity.
 * Nothing on this screen blurs; the page background is the stage.
 *
 * Her place is stated once, where she is: the podium face or her pill. Her
 * movement, which is the only movement the data can state exactly, sits beside
 * her rank number. Presentational on purpose: `Leaderboards.tsx` owns the data
 * and the preview route supplies fixtures.
 */

interface BoardPanelProps {
  state: 'loading' | 'error' | 'ready';
  /** Exactly three rows (rank order) when the podium is shown, else empty. */
  podium: LeaderboardRow[];
  items: BoardItem[];
  faces: Record<string, string>;
  /** Places she gained since the window before this one; null when unknown. */
  moved: number | null;
  range: RangeKey;
  onRange: (r: RangeKey) => void;
  brands: { id: string; name: string }[];
  brand: string | null;
  /** Null hides the brand control (a fixed brand, or nothing to choose). */
  onBrand: ((id: string | null) => void) | null;
  search: string;
  /** Null hides the search box. */
  onSearch: ((s: string) => void) | null;
  page: number;
  pages: number;
  onPage: (n: number) => void;
  fetching: boolean;
  onRetry: () => void;
}

/** Ring and glow for first, second, third: the accent at three strengths. */
const GLOW = [
  '0 0 0 0.1875rem var(--wx-accent), 0 0 2rem var(--wx-accent-ring)',
  '0 0 0 0.125rem var(--wx-accent-ring), 0 0 1.25rem var(--wx-accent-soft)',
  '0 0 0 0.0625rem var(--wx-accent-ring), 0 0 0.875rem var(--wx-accent-soft)',
];
/** Face sizes are CSS variables (set on the podium) so they scale with the screen. */
const FACE_VAR = ['var(--f1)', 'var(--f2)', 'var(--f2)'];

function Moved({ by }: { by: number | null }) {
  if (!by) return null;
  return (
    <span
      className="text-accent wx-numeric inline-flex items-center font-mono text-[0.6875rem] font-bold"
      aria-label={`${by > 0 ? 'Up' : 'Down'} ${Math.abs(by)}`}
    >
      {by > 0 ? <ArrowUp size={12} aria-hidden /> : <ArrowDown size={12} aria-hidden />}
      {Math.abs(by)}
    </span>
  );
}

function PodiumPlace({
  row,
  i,
  faces,
  moved,
}: {
  row: LeaderboardRow;
  i: number;
  faces: Record<string, string>;
  moved: number | null;
}) {
  const first = i === 0;
  return (
    <li
      aria-current={row.is_me ? 'true' : undefined}
      className={cn(
        'flex min-w-0 flex-col items-center gap-1 text-center',
        first ? 'order-2' : i === 1 ? 'order-1 pt-8 md:pt-10 lg:pt-14' : 'order-3 pt-8 md:pt-10 lg:pt-14'
      )}
    >
      <span className="wx-numeric text-muted flex items-center gap-1 font-mono text-[0.8125rem] font-bold lg:text-[1rem]">
        {row.rank}
        {row.is_me ? <Moved by={moved} /> : null}
      </span>
      {first ? <Crown aria-hidden className="text-accent -mt-0.5 size-[1.375rem] lg:size-8" /> : null}
      <span
        className="mt-1 rounded-full"
        style={{ boxShadow: GLOW[i] }}
      >
        <CreatorFace
          /* px by this shared component's own API. */
          size={0}
          style={{ width: FACE_VAR[i], height: FACE_VAR[i], fontSize: `calc(${FACE_VAR[i]} * 0.4)` }}
          src={row.avatar_path ? faces[row.avatar_path] : undefined}
          name={row.display_name}
        />
      </span>
      <span
        className={cn(
          'mt-2 w-full truncate font-semibold',
          first ? 'text-[0.9375rem] md:text-[1rem] lg:text-[1.1875rem]' : 'text-[0.8125rem] md:text-[0.875rem] lg:text-[1rem]',
          row.is_me ? 'text-accent' : 'text-muted'
        )}
      >
        {row.display_name ?? 'A creator'}
      </span>
      {row.is_me ? <span className="text-muted -mt-1 text-[0.6875rem] lg:text-[0.8125rem]">you</span> : null}
      <span
        title={`${tipMoney(row.gmv, row.currency)} GMV`}
        className={cn(
          'wx-numeric text-accent font-mono font-extrabold',
          first ? 'text-[1.125rem] md:text-[1.25rem] lg:text-[1.625rem]' : 'text-[0.9375rem] md:text-[1rem] lg:text-[1.25rem]'
        )}
      >
        {faceMoney(row.gmv, row.currency)}
      </span>
    </li>
  );
}

export function BoardPanel(p: BoardPanelProps) {
  const quiet = useReducedMotion();
  const showBrands = p.onBrand !== null && p.brands.length > 1;
  const empty = p.podium.length === 0 && p.items.length === 0;

  return (
    <m.div
      initial={quiet ? false : { opacity: 0, y: '0.5rem' }}
      animate={{ opacity: 1, y: '0rem' }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      className="mx-auto flex w-full max-w-[26rem] flex-col gap-5 md:max-w-[36rem] md:gap-6 lg:max-w-[44rem] xl:max-w-[52rem]"
    >
      <div className="wx-tap-row flex flex-wrap items-center justify-center gap-2">
        <FilterTabs label="Over what period">
          {RANGES.map((r) => (
            <FilterTab key={r.key} active={p.range === r.key} onClick={() => p.onRange(r.key)}>
              {r.label}
            </FilterTab>
          ))}
        </FilterTabs>
        {showBrands ? <BrandFilter brands={p.brands} value={p.brand} onChange={p.onBrand!} allowAll={false} /> : null}
      </div>

      {p.onSearch ? (
        <div className="wx-tap-row mx-auto flex w-full max-w-[34rem]">
          <CreatorSearch
            value={p.search}
            onChange={p.onSearch}
            placeholder="Find a creator"
            label="Find a creator"
            className="sm:max-w-none"
          />
        </div>
      ) : null}

      {p.state === 'loading' ? (
        <div className="flex flex-col gap-2" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <NeoCardSkeleton key={i} className="h-[3.25rem] rounded-full" />
          ))}
        </div>
      ) : p.state === 'error' ? (
        <div role="alert" className="wx-tap-row flex items-center justify-between gap-3 px-1 py-2">
          <p className="text-[0.9375rem] font-semibold">The board did not load</p>
          <button
            type="button"
            onClick={p.onRetry}
            className="wx-neo-raised-sm wx-neo-press text-accent min-h-11 rounded-full px-4 text-[0.8125rem] font-semibold"
          >
            Retry
          </button>
        </div>
      ) : empty ? (
        <p className="text-muted px-1 py-10 text-center text-[0.9375rem] font-semibold">
          No creators yet
        </p>
      ) : (
        <>
          {p.podium.length === 3 ? (
            <ol
              aria-label="Top three"
              className="grid grid-cols-3 items-start gap-2 px-1 [--f1:5.5rem] [--f2:4rem] md:gap-6 md:[--f1:6.5rem] md:[--f2:4.5rem] lg:gap-10 lg:[--f1:8rem] lg:[--f2:5.5rem] xl:px-8"
            >
              {p.podium.map((row, i) => (
                <PodiumPlace key={row.creator_id} row={row} i={i} faces={p.faces} moved={p.moved} />
              ))}
            </ol>
          ) : null}

          {p.items.length > 0 ? (
            <ol
              className={cn(
                'mx-auto flex w-full max-w-[26rem] flex-col gap-2 [--row-face:2.375rem] md:max-w-[34rem] lg:gap-2.5 lg:[--row-face:3rem]',
                p.fetching && 'opacity-70'
              )}
            >
              {p.items.map((item) =>
                item.kind === 'gap' ? (
                  <li
                    key="gap"
                    aria-label={`${item.hidden} more`}
                    className="text-faint flex min-h-8 items-center justify-center text-[1rem] leading-none tracking-[0.4em]"
                  >
                    <span aria-hidden>···</span>
                  </li>
                ) : (
                  <Row key={item.row.creator_id} item={item} faces={p.faces} moved={p.moved} />
                )
              )}
            </ol>
          ) : null}

          {p.pages > 1 ? (
            <div className="wx-tap-row mx-auto flex w-full max-w-[34rem] items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Previous"
                disabled={p.page === 0 || p.fetching}
                onClick={() => p.onPage(Math.max(0, p.page - 1))}
                className="wx-neo-raised-sm wx-neo-press text-muted hover:text-accent inline-flex min-h-11 min-w-11 items-center justify-center rounded-full disabled:opacity-30"
              >
                <ChevronLeft size={18} aria-hidden />
              </button>
              <span className="wx-numeric text-muted font-mono text-[0.75rem]">
                {p.page + 1} / {p.pages}
              </span>
              <button
                type="button"
                aria-label="Next"
                disabled={p.page + 1 >= p.pages || p.fetching}
                onClick={() => p.onPage(p.page + 1)}
                className="wx-neo-raised-sm wx-neo-press text-muted hover:text-accent inline-flex min-h-11 min-w-11 items-center justify-center rounded-full disabled:opacity-30"
              >
                <ChevronRight size={18} aria-hidden />
              </button>
            </div>
          ) : null}
        </>
      )}
    </m.div>
  );
}

function Row({
  item,
  faces,
  moved,
}: {
  item: Extract<BoardItem, { kind: 'row' }>;
  faces: Record<string, string>;
  moved: number | null;
}) {
  const { row } = item;
  return (
    <li
      aria-current={row.is_me ? 'true' : undefined}
      className={cn(
        'flex min-h-[3.25rem] items-center gap-2.5 rounded-full py-1.5 pr-5 pl-2 lg:min-h-[4rem] lg:gap-3.5 lg:pr-7 lg:pl-3',
        /* Her pill drops the raised shadow for the accent ring: both are a
           `box-shadow`, so they cannot share one element. */
        row.is_me ? 'bg-accent-soft ring-accent ring-2' : 'wx-neo-raised-sm'
      )}
    >
      <span className="wx-numeric text-muted flex w-9 shrink-0 flex-col items-center font-mono text-[0.8125rem] leading-tight font-bold lg:w-11 lg:text-[0.9375rem]">
        {row.rank}
        {row.is_me ? <Moved by={moved} /> : null}
      </span>

      <CreatorFace
        /* px by this shared component's own API. */
        size={0}
        style={{ width: 'var(--row-face)', height: 'var(--row-face)', fontSize: 'calc(var(--row-face) * 0.4)' }}
        src={row.avatar_path ? faces[row.avatar_path] : undefined}
        name={row.display_name}
      />

      <span
        className={cn(
          'min-w-0 flex-1 truncate text-[0.9375rem] font-semibold lg:text-[1.0625rem]',
          row.is_me && 'text-accent'
        )}
      >
        {row.display_name ?? 'A creator'}
        {row.is_me ? <span className="text-muted font-medium"> · you</span> : null}
      </span>

      <span
        title={`${tipMoney(row.gmv, row.currency)} GMV`}
        className="wx-numeric text-accent shrink-0 font-mono text-[1rem] font-extrabold lg:text-[1.1875rem]"
      >
        {faceMoney(row.gmv, row.currency)}
      </span>
    </li>
  );
}
