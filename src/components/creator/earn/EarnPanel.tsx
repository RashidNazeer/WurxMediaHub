import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * ONE BLURRED PANEL PER SCREEN. This is the layering rule, made into a
 * component so neither Earn screen can forget it.
 *
 * THE BUDGET IS THREE BLURRED LAYERS PAINTING AT ONCE, and `wx-neo-raised`
 * carries a `backdrop-filter` at every width now. A list of fifteen contest
 * cards each wearing it is fifteen full-size blurs recomputed on every scroll
 * frame — the exact scroll lag `scripts/verify/design/check-blur-budget.mjs` exists to catch.
 *
 * So the layering on these two screens is:
 *
 *   Layer A  the top bar (`wx-glass-chrome`, drawn by the shell)
 *   Layer B  THIS, one panel holding the controls and the whole list
 *   Layer C  a dialog or bottom sheet, only while it is open
 *
 * Everything inside is `wx-neo-raised-sm`: the SAME material — same fill, same
 * lit rims, same seat — with the blur dropped. At a tile's size the blur was
 * never readable anyway, which is why the small variant gave it up.
 *
 * NOTHING IN HERE MAY ADD `backdrop-filter`, and nothing may nest another
 * `wx-neo-raised`. Two is not more glass, it is two blurs of the same gradient.
 */
export function EarnPanel({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('wx-neo-raised mt-4 rounded-xl p-3 sm:p-4', className)}>{children}</div>
  );
}

/**
 * One headed group inside the panel: "Your entries", then "Open to join".
 *
 * The heading is a real `h2` because the groups are the structure of the page,
 * not decoration, and a creator using a screen reader should be able to jump
 * between them.
 */
export function EarnGroup({
  title,
  count,
  note,
  className,
  children,
}: {
  title: string;
  /** Shown as a quiet figure beside the heading. Omit when it would be noise. */
  count?: number;
  /** One short line under the heading. Not a paragraph. */
  note?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('mt-4 first:mt-2', className)}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-1">
        <h2 className="text-muted text-[0.6875rem] font-semibold tracking-[0.14em] uppercase">
          {title}
        </h2>
        {count !== undefined ? (
          <span className="text-faint wx-numeric text-[0.6875rem] font-semibold">{count}</span>
        ) : null}
      </div>
      {note ? (
        <p className="text-faint mt-1 max-w-prose px-1 text-[0.75rem] leading-relaxed">{note}</p>
      ) : null}
      {children}
    </section>
  );
}

/**
 * The grid the tiles sit in.
 *
 * `auto-fill` with a `min()` floor rather than fixed breakpoints, so the same
 * grid works at 375 (one column), on a tablet (two) and inside a Brand Hub,
 * where the column is narrower than the page by the width of the rail.
 */
export function EarnGrid({
  min = '22rem',
  className,
  children,
}: {
  /** The narrowest a tile may get before the grid drops a column. */
  min?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <ul
      /* Equal heights at rest: cards in a row stretch to the tallest, so a card
          with a button beside one without no longer reads as a size mismatch.
          While any card has "Details" open the row drops to `items-start`, so
          the open card grows and its neighbours do not become tall empty boxes
          (Rashid: "I clicked on details of one card why all extended?"). */
      className={cn(
        'mt-2.5 grid items-stretch gap-2.5 has-[details[open]]:items-start sm:gap-3 [&>li]:flex [&>li>*]:w-full',
        className
      )}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${min}), 1fr))` }}
    >
      {children}
    </ul>
  );
}

/**
 * A loading placeholder that already wears the tile it will become.
 *
 * NOT `NeoCardSkeleton`, which is `wx-neo-raised` — six of those inside this
 * panel would be six blurred layers nested inside a seventh, which is the one
 * thing `check-blur-budget.mjs` fails on outright: a blurred element inside
 * another pays twice and looks the same, because the inner one is sampling a
 * backdrop that has already been blurred.
 *
 * The shell is the real material and only the contents shimmer, so the layout
 * does not jump from "painted rectangle" to "extruded tile" when data arrives.
 */
export function EarnTileSkeleton({ className }: { className?: string }) {
  return (
    <li aria-hidden className={cn('wx-neo-raised-sm rounded-xl p-3.5', className)}>
      <div className="flex h-full flex-col gap-3">
        <div className="wx-skeleton h-5 w-28 shrink-0 rounded-full" />
        <div className="wx-skeleton h-4 w-3/4 shrink-0" />
        <div className="wx-skeleton h-7 w-24 shrink-0" />
        <div className="wx-skeleton min-h-6 flex-1" />
      </div>
    </li>
  );
}
