import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * ROW ONE OF EVERY ADMIN SCREEN: tabs, search, filters, on one line, in one
 * panel with a see-through border.
 *
 * BUILT 2026-08-16 FROM RASHID'S INSTRUCTION, which was specific enough to
 * quote: the section name moves into the top bar, the title row and the
 * description row under it go away entirely, and the first thing on the page is
 * the row of controls, "with transparent borders around that whole row", corners
 * only "very slightly rounded ... do not give it circle look please, the one we
 * have in contest is fine".
 *
 * So this is literally the contests filter row, lifted out and shared, rather
 * than a new interpretation of it. `wx-glass-panel` is the translucent border,
 * `rounded-lg` is the radius he approved. Every screen using this cannot drift
 * from the one he signed off.
 *
 * WHAT GOES IN IT: the controls that change what the list below shows, and
 * nothing else. Not counts, not a heading, not an explanation. The one exception
 * is `action`, which pins a single primary button to the far right of the row on
 * screens where the thing that creates a record has nowhere better to be.
 *
 * IT WRAPS RATHER THAN SCROLLS. At 375px the controls stack inside the panel;
 * a row that scrolls sideways hides a filter behind an edge, and on a phone
 * nobody finds it.
 */
export function FilterBar({
  action,
  oneLine,
  className,
  children,
}: {
  /** Optional primary action, pinned right. */
  action?: ReactNode;
  /**
   * Keep the row on ONE line at every width instead of wrapping.
   *
   * Opt-in, and the default stays wrapping on purpose — see the note above:
   * a bar that wraps can never push a filter off the screen, and that was a
   * real bug once. Use this only where the row is short enough to hold, and
   * give the widest child `min-w-0` plus its own scroller so the squeeze lands
   * somewhere harmless. Rashid asked for it on the creator numbers screen,
   * 2026-10-16: "on phone move all these in one line."
   */
  oneLine?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        // `wx-tap-row` keeps every control in here thumb-sized on a phone and
        // lets it be dense above `sm`. See global.css for why it is px.
        'wx-neo-raised wx-tap-row flex items-center gap-2 rounded-lg p-2',
        oneLine ? 'flex-nowrap' : 'flex-wrap',
        className
      )}
    >
      {children}
      {/*
        `max-w-full` as well as `shrink-0`.

        `shrink-0` is right for the usual action, a button whose label must not
        be squashed. It is wrong on its own for an action that is itself a
        scroller: the brand switcher on a hub is a `nav` with `overflow-x-auto`
        and `max-w-full`, and its `max-w-full` resolved against a wrapper that
        could never shrink, so the scroller was always exactly as wide as its
        contents and never clipped anything. Four brand chips put 2px of
        horizontal scroll on the whole page at 375.

        Capping the wrapper at the bar's own width bounds the scroller without
        letting a button's label squash, and the bar already wraps, so a wide
        action simply takes its own line.
      */}
      {action ? <div className="ml-auto max-w-full shrink-0">{action}</div> : null}
    </div>
  );
}

/**
 * The segmented control that goes at the left of a `FilterBar`.
 *
 * Every admin screen had grown its own: different heights, different radii,
 * three different ways of showing a count. This is the contests one, which is
 * the one Rashid approved.
 *
 * IT WRAPS, AND IT IS NOT ALLOWED TO REFUSE TO SHRINK. It was `shrink-0` with
 * `shrink-0` tabs inside it, which at 375px made any screen with five states —
 * Requests, and every other queue with Waiting / Approved / Rejected /
 * Withdrawn / All — wider than the phone it was on, so the whole PAGE scrolled
 * sideways and "All" sat off the edge. Found on 2026-08-21 by the width check
 * in `shots-admin.mjs`; it had been true since the row was shared.
 *
 * Wrapping rather than scrolling, deliberately, and for the reason `FilterBar`
 * itself gives above: a row that scrolls sideways hides a filter behind an edge,
 * and on a phone nobody finds it. Nothing changes at any width where the tabs
 * already fit.
 */
export function FilterTabs({
  label,
  className,
  children,
}: {
  /** What the group of tabs filters, for a screen reader. */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        'wx-neo-inset flex max-w-full flex-wrap items-center gap-0.5 rounded-md p-1',
        className
      )}
    >
      {children}
    </div>
  );
}

export function FilterTab({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  /** Shown as a quiet number after the label. Omit when there is nothing to count. */
  count?: number | undefined;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      role="tab"
      type="button"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'ease-brand flex min-h-8 shrink-0 items-center gap-1.5 rounded-sm px-2.5 text-[0.8125rem] font-medium transition-colors duration-200',
        /* The selected tab is a filled pill, so it takes his colour with ink
           on it. The unselected ones are TEXT and keep the accent ink. */
        active
          ? '[background-color:var(--wx-accent-fill)] [color:var(--wx-on-accent-fill)]'
          : 'text-muted hover:text-accent'
      )}
    >
      {children}
      {count !== undefined ? (
        <span
          className={cn(
            'wx-numeric text-[0.6875rem] font-semibold',
            // `text-muted`, never `text-faint`: faint on surface-2 is 4.31:1 in
            // light mode, under AA. Registered in scripts/build/check-contrast.mjs.
            //
            // THE ACTIVE COUNT IS THE EASY ONE TO MISS. It used to be
            // `text-on-accent/80` — white at 80% — which was right over the old
            // saturated accent and is unreadable over #C3BEF0. It is ink at 80%
            // now, which is ~7:1 on the fill rather than 1.6:1.
            active
              ? '[color:color-mix(in_oklab,var(--wx-on-accent-fill)_80%,transparent)]'
              : 'text-muted'
          )}
        >
          {count}
        </span>
      ) : null}
    </button>
  );
}
