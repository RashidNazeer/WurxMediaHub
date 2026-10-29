import { useState, type ReactNode } from 'react';
import { CircleAlert, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

/**
 * The two states a screen can be in when it has nothing to show, and they are
 * NOT the same state.
 *
 * "We could not load this" and "there is nothing here yet" are different facts
 * about the world, and a creator does completely different things about them:
 * one is worth a retry in ten seconds, the other means go and film something.
 * Drawn the same way they are indistinguishable, and the quiet failure reads
 * as "you have earned nothing", which is the single worst thing this product
 * can say by accident.
 *
 * WHY THIS EXISTS AS ONE COMPONENT. There were 79 hand-written error branches
 * across 29 files and no shared piece, and `refetch()` appeared in five files,
 * every one of them admin. No creator-facing screen in the product offered a
 * way to try again: a failed request left a sentence and a dead end. So the
 * retry is built into this component rather than left to each caller to
 * remember.
 *
 * Both of these are borderless and carry their meaning in material and tone,
 * per the house rule that shadows do the work borders used to.
 */

/**
 * D — FAILED. Something broke on the way to the data.
 *
 * Tinted with the danger wash and led by an icon, so it reads as "wrong" at a
 * glance and can never be mistaken for an ordinary empty shelf. The retry
 * handles its own pending state, because every caller otherwise writes the
 * same three lines of `useState` and a third of them forget the disabled.
 */
export function DataError({
  title = 'We could not load this',
  body = 'Something went wrong on our side, not yours. Nothing is lost.',
  onRetry,
  className,
}: {
  title?: string;
  body?: ReactNode;
  /** Usually a TanStack Query `refetch`. Omit when there is nothing to retry. */
  onRetry?: () => Promise<unknown> | void;
  className?: string;
}) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    if (!onRetry || retrying) return;
    setRetrying(true);
    try {
      await onRetry();
    } finally {
      /* Always cleared, including when the retry fails again: a spinner that
         never stops is a worse failure than the one it was reporting. */
      setRetrying(false);
    }
  }

  return (
    <div
      role="alert"
      className={cn(
        'wx-neo-raised flex min-w-0 flex-col items-start gap-3 rounded-2xl p-[clamp(1.125rem,2vw,1.5rem)]',
        className
      )}
    >
      <span className="bg-danger-soft text-danger grid size-10 shrink-0 place-items-center rounded-full">
        <CircleAlert size={18} aria-hidden />
      </span>

      <div className="flex flex-col gap-1">
        <p className="text-[0.9375rem] leading-[1.3] font-semibold">{title}</p>
        <p className="text-muted text-[0.8125rem] leading-[1.45]">{body}</p>
      </div>

      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={retry} disabled={retrying}>
          <RotateCw
            size={14}
            aria-hidden
            className={retrying ? 'motion-safe:animate-spin' : undefined}
          />
          {retrying ? 'Trying again' : 'Try again'}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * B and C — NOTHING HERE YET, which is a normal and often good state.
 *
 * No tint and no alert icon: this is not a problem, so it must not borrow the
 * clothes of one. Warm, specific copy belongs to the caller, because the only
 * useful empty state names the actual thing that is missing and what fills it.
 */
export function EmptyState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: ReactNode;
  /** One obvious next step, when there is one. Never more than one. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'wx-neo-raised flex min-w-0 flex-col items-start gap-2 rounded-2xl p-[clamp(1.125rem,2vw,1.5rem)]',
        className
      )}
    >
      <p className="text-[0.9375rem] leading-[1.3] font-semibold">{title}</p>
      <p className="text-muted max-w-prose text-[0.8125rem] leading-[1.45]">{body}</p>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
