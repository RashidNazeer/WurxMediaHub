import { useEffect, useRef, type ReactNode } from 'react';
import { m } from 'motion/react';
import { X } from 'lucide-react';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { cn } from '@/lib/utils';

/**
 * The shell every Backup data dialog sits in. Same look and behaviour as the
 * brand and offer dialogs: dim backdrop, panel rising from the bottom on a
 * phone, focus kept inside, Escape and the backdrop close it (unless it is busy,
 * because closing a dialog must never look like cancelling a restore).
 */
export function Modal({
  title,
  subtitle,
  onClose,
  busy = false,
  wide = false,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  /** While true the dialog cannot be dismissed. */
  busy?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, { initialSelector: 'input, button' });

  // On the document, not the panel: a button that disables itself drops focus to the page,
  // and Escape must still close the dialog from there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => !busy && onClose()}
        className="fixed inset-0 cursor-default bg-black/70 backdrop-blur-sm"
      />

      <m.div
        ref={panelRef}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className={cn(
          // OPAQUE on purpose. The glass panels let the page show through, which is fine for a
          // card and wrong for a dialog where somebody is about to type RESTORE.
          'wx-neo-raised bg-surface-1 border-line relative max-h-[100dvh] border w-full overflow-y-auto rounded-t-2xl p-5 sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl sm:p-7',
          wide ? 'max-w-2xl' : 'max-w-lg'
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{title}</h2>
            {subtitle ? (
              <div className="text-muted mt-1 text-[0.875rem] leading-relaxed">{subtitle}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            disabled={busy}
            aria-label="Close"
            className="text-muted hover:text-accent -mt-1 -mr-1 grid size-11 shrink-0 place-items-center rounded-lg transition-colors disabled:opacity-40"
          >
            <X size={17} aria-hidden />
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </m.div>
    </div>
  );
}

/** A plain-words box for a warning, an error or good news. */
export function Notice({
  tone,
  children,
  className,
}: {
  tone: 'warn' | 'bad' | 'good' | 'info';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    warn: 'bg-warning-soft text-text',
    bad: 'bg-danger-soft text-text',
    good: 'bg-success-soft text-text',
    info: 'bg-surface-2 text-text',
  } as const;
  return (
    <div
      role={tone === 'bad' ? 'alert' : undefined}
      className={cn('rounded-xl px-4 py-3 text-[0.875rem] leading-relaxed', tones[tone], className)}
    >
      {children}
    </div>
  );
}
