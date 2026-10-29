import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpToLine, ChevronDown, ExternalLink, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal, Notice } from '@/components/admin/backups/Modal';
import { cn } from '@/lib/utils';
import { callAngles } from './collab-angles-api';

/**
 * THE CATEGORISE QUEUE, to look at and to edit.
 *
 * Umar: "the user must be able to see the queue and on opening the queue the
 * user must be able to see which brands' videos are in queue and user must be
 * able to edit it as well", and then: "the categorise button should open the
 * queue showing all the statuses and the features I mentioned before".
 *
 * So the Categorise button no longer starts a run by itself. It opens this
 * dialog, and starting a brand's month is the first thing inside it. Below that
 * is every brand and month with videos in the queue, in the order the worker
 * will take them, filterable by status, each openable to see its videos and
 * editable: move a brand to the front, remove single videos or the whole brand,
 * put failed ones back.
 *
 * EVERY STATUS IS SHOWN: waiting, with the audit server, failed, needs a look,
 * and the two that are finished (filed, skipped). The finished ones are history
 * and are read-only here, like a video that is with the audit server right now.
 *
 * LIKE THE BUTTON, THIS NEVER TOUCHES THE DATABASE. Every read and every edit is
 * a `queue.*` action on the `collab-angles` Edge Function, which re-checks that
 * the caller is staff and writes the audit log. It names rows by id, brand and
 * month and never takes a link, so the audit machine can still only be given
 * videos the function derived itself.
 *
 * The dialog is portalled to the body. It is mounted inside the vendored
 * Paid Collabs root, whose own stylesheet and stacking would otherwise reach it.
 */

type Status = 'queued' | 'sent' | 'failed' | 'needs_review' | 'filed' | 'skipped';

type QVideo = {
  id: string;
  video_url: string;
  video_id: string;
  creator: string | null;
  status: Status;
  attempts: number;
  last_error: string | null;
  angle: string | null;
};

type QGroup = {
  brand: string;
  month: string;
  counts: Record<Status, number>;
  videos: QVideo[];
};

type QueueData = {
  groups: QGroup[];
  totals: Record<Status, number>;
  truncated: boolean;
  historyTruncated: boolean;
  waitSeconds: number;
  waitReason: string | null;
};

/** In the order a video moves through them, which is the order the chips read. */
const STATUSES: Status[] = ['queued', 'sent', 'failed', 'needs_review', 'filed', 'skipped'];
/** The ones still to be done, which the button's count is made of. */
const PENDING: Status[] = ['queued', 'sent', 'failed', 'needs_review'];
/** The only ones an edit may remove. The function enforces the same list. */
const REMOVABLE: Status[] = ['queued', 'failed', 'needs_review'];

const LABEL: Record<Status, string> = {
  queued: 'Waiting',
  sent: 'With the audit server',
  failed: 'Failed',
  needs_review: 'Needs a look',
  filed: 'Filed',
  skipped: 'Skipped',
};

const PILL: Record<Status, string> = {
  queued: 'bg-surface-2 text-text',
  sent: 'bg-accent-soft text-text',
  failed: 'bg-danger-soft text-text',
  needs_review: 'bg-warning-soft text-text',
  filed: 'bg-success-soft text-text',
  skipped: 'bg-surface-2 text-muted',
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const zero = (): Record<Status, number> => ({
  queued: 0,
  sent: 0,
  failed: 0,
  needs_review: 0,
  filed: 0,
  skipped: 0,
});
const countsOf = (raw: unknown): Record<Status, number> => {
  const c = (raw ?? {}) as Record<string, unknown>;
  const out = zero();
  for (const s of STATUSES) out[s] = num(c[s]);
  return out;
};

function toQueue(raw: unknown): QueueData {
  const r = (raw ?? {}) as Record<string, unknown>;
  const groups = (Array.isArray(r.groups) ? r.groups : []).map((g): QGroup => {
    const o = g as Record<string, unknown>;
    return {
      brand: String(o.brand ?? ''),
      month: String(o.month ?? ''),
      counts: countsOf(o.counts),
      videos: (Array.isArray(o.videos) ? o.videos : []).map((v): QVideo => {
        const x = v as Record<string, unknown>;
        return {
          id: String(x.id ?? ''),
          video_url: String(x.video_url ?? ''),
          video_id: String(x.video_id ?? ''),
          creator: typeof x.creator === 'string' ? x.creator : null,
          status: (STATUSES.includes(x.status as Status) ? x.status : 'queued') as Status,
          attempts: num(x.attempts),
          last_error: typeof x.last_error === 'string' ? x.last_error : null,
          angle: typeof x.angle === 'string' ? x.angle : null,
        };
      }),
    };
  });
  return {
    groups,
    totals: countsOf(r.totals),
    truncated: r.truncated === true,
    historyTruncated: r.history_truncated === true,
    waitSeconds: num(r.wait_seconds),
    waitReason: typeof r.wait_reason === 'string' ? r.wait_reason : null,
  };
}

const pendingCount = (t: Record<Status, number>) => PENDING.reduce((n, s) => n + t[s], 0);

/** "2026-10" as "Oct 2026". The month is a label here, never parsed back. */
function monthName(m: string): string {
  const [y, mo] = m.split('-').map(Number);
  if (!y || !mo) return m;
  return new Date(Date.UTC(y, mo - 1, 1)).toLocaleString('en-GB', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** What a person should read for the worker's last environmental problem. */
function plainReason(reason: string | null): string | null {
  if (!reason) return null;
  if (/download|cookies|datacentre/i.test(reason)) {
    return 'TikTok is refusing downloads from the audit server, so its login cookies may need refreshing.';
  }
  if (/module_failed|quota|rate|gemini|resource|no visual evidence|angle judgement/i.test(reason)) {
    return 'The Gemini model is not answering, most likely because its daily free quota is used up.';
  }
  return reason;
}

const minutes = (s: number) => Math.max(1, Math.round(s / 60));
const videos = (n: number) => `${n} video${n === 1 ? '' : 's'}`;

type Props = {
  open: boolean;
  onClose: () => void;
  canEdit: boolean;
  /** The brand and month on screen, which the Categorise action inside is for. */
  brand: string;
  month: string;
  /** Start categorising the brand and month on screen. */
  onStart: () => Promise<void>;
  /** A start is being made, or one is in flight for this brand and month. */
  startBusy: boolean;
  /** What the last start said, and the last problem, as the button's own screen holds them. */
  startNote: string | null;
  startError: string | null;
  /** Told how many videos are still to be done, for the count on the button. */
  onCount?: (n: number) => void;
  /** Called after an edit changes what Categorise would say about a brand. */
  onChanged?: () => void;
};

export function CollabAngleQueue({
  open,
  onClose,
  canEdit,
  brand,
  month,
  onStart,
  startBusy,
  startNote,
  startError,
  onCount,
  onChanged,
}: Props) {
  const [data, setData] = useState<QueueData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<string | null>(null);

  const alive = useRef(true);
  const loading = useRef(false);
  const onCountRef = useRef(onCount);
  useEffect(() => {
    onCountRef.current = onCount;
  }, [onCount]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    try {
      const raw = await callAngles<unknown>({ action: 'queue.list' }, 'Could not read the queue.');
      if (!alive.current) return;
      const next = toQueue(raw);
      setData(next);
      setError(null);
      onCountRef.current?.(pendingCount(next.totals));
      /* Forget picks that no longer exist, so a button never offers to remove a
         video the worker has already taken. */
      const live = new Set(next.groups.flatMap((g) => g.videos.map((v) => v.id)));
      setPicked((p) => new Set([...p].filter((id) => live.has(id))));
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      loading.current = false;
    }
  }, []);

  /* A slow look while closed, for the count on the button; a fast one while the
     dialog is open, because somebody editing a queue wants to see it move. Not
     while the tab is hidden. */
  useEffect(() => {
    if (!canEdit) return;
    void load();
    const id = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') void load();
      },
      open ? 5_000 : 30_000,
    );
    return () => window.clearInterval(id);
  }, [canEdit, open, load]);

  const run = async (
    key: string,
    body: Record<string, unknown>,
    done: (r: Record<string, unknown>) => string,
  ) => {
    if (busy) return;
    setBusy(key);
    setNotice(null);
    setError(null);
    setConfirm(null);
    try {
      const r = await callAngles<Record<string, unknown>>(body, 'That did not work.');
      if (!alive.current) return;
      setNotice(done(r));
      setPicked(new Set());
      await load();
      onChanged?.();
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const start = async () => {
    setNotice(null);
    await onStart();
    if (alive.current) await load();
  };

  if (!canEdit || !open) return null;

  const pending = data ? pendingCount(data.totals) : 0;
  const finished = data ? data.totals.filed + data.totals.skipped : 0;
  const toggle = (set: Set<string>, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  };

  /* A group shows only the videos that match the chip, and drops out when none
     do, so "Failed" is a list of brands with failures and nothing else. */
  const shown = (data?.groups ?? [])
    .map((g) => ({ g, vids: filter === 'all' ? g.videos : g.videos.filter((v) => v.status === filter) }))
    .filter((x) => x.vids.length > 0);
  const nextKey = (() => {
    const first = (data?.groups ?? []).find((g) => g.counts.queued > 0);
    return first ? `${first.brand}|${first.month}` : null;
  })();

  return createPortal(
    <Modal
      wide
      title="Categorise"
      subtitle={
        data
          ? `${pending === 0 ? 'Nothing is waiting' : `${videos(pending)} still to do`}, ${finished} filed or skipped.` +
            (nextKey ? ' The first waiting brand is taken next.' : '')
          : 'Loading…'
      }
      onClose={onClose}
      /* NEVER `busy`. The Modal's `busy` disables the close cross, Escape and the
         backdrop, which is right for a restore and wrong here: it was passed
         "a run is in flight", so while any batch was out with the audit server
         (which is most of the time) the cross did nothing. An edit that is
         still on its way finishes on the server whether this is open or not,
         and the result is read on the next look. */
    >
      <div className="mt-5 space-y-4">
        {brand && month ? (
          <div className="bg-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3">
            <div className="min-w-0 text-[0.875rem]">
              <span className="font-semibold">
                {brand} {monthName(month)}
              </span>
              <span className="text-muted block text-[0.8125rem]">
                Queue this brand's videos for the month that are not yet in an angle.
              </span>
            </div>
            <Button size="sm" onClick={start} disabled={startBusy || busy !== null}>
              <Sparkles size={14} aria-hidden /> Categorise {brand}
            </Button>
          </div>
        ) : null}

        {startError ? <Notice tone="bad">{startError}</Notice> : null}
        {startNote && !startError ? <Notice tone="info">{startNote}</Notice> : null}
        {error ? <Notice tone="bad">{error}</Notice> : null}
        {notice ? <Notice tone="good">{notice}</Notice> : null}

        {data && data.waitSeconds > 0 ? (
          <Notice tone="warn">
            The worker is pausing for about {minutes(data.waitSeconds)} min before the next batch,
            because the last one could not run. {plainReason(data.waitReason)}{' '}
            Videos stay in the queue meanwhile and are not marked failed.
          </Notice>
        ) : null}

        {data && data.truncated ? (
          <Notice tone="info">
            The queue is longer than can be shown here. The oldest 1000 waiting videos are listed.
          </Notice>
        ) : null}

        {data ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
            {(['all', ...STATUSES] as const).map((s) => {
              const n = s === 'all' ? pending + finished : data.totals[s];
              if (s !== 'all' && n === 0) return null;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setFilter(s)}
                  aria-pressed={filter === s}
                  className={cn(
                    'rounded-full px-3 py-1 text-[0.8125rem] font-semibold transition-colors',
                    filter === s ? 'bg-accent text-on-accent' : 'bg-surface-2 text-text hover:bg-accent-soft',
                  )}
                >
                  {s === 'all' ? 'All' : LABEL[s]} <span className="opacity-80">{n}</span>
                </button>
              );
            })}
          </div>
        ) : null}

        {data && shown.length === 0 && !error ? (
          <p className="text-muted py-6 text-center text-[0.875rem]">
            {pending + finished === 0
              ? 'The queue is empty. Use the button above to add a brand.'
              : 'No videos have this status.'}
          </p>
        ) : null}

        <ul className="space-y-3">
          {shown.map(({ g, vids }) => {
            const key = `${g.brand}|${g.month}`;
            const isOpen = expanded.has(key);
            const removable = g.videos.filter((v) => REMOVABLE.includes(v.status));
            const pickedHere = g.videos.filter((v) => picked.has(v.id));
            const isNext = key === nextKey;
            return (
              <li key={key} className="wx-neo-raised-sm bg-surface-1 rounded-xl p-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <button
                    type="button"
                    onClick={() => setExpanded((s) => toggle(s, key))}
                    aria-expanded={isOpen}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  >
                    <ChevronDown
                      size={16}
                      aria-hidden
                      className={cn('text-muted shrink-0 transition-transform', isOpen ? 'rotate-180' : '')}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[0.9375rem] font-bold">
                        {g.brand} <span className="text-muted font-medium">{monthName(g.month)}</span>
                        {isNext ? (
                          <span className="bg-accent-soft ml-2 rounded-full px-2 py-0.5 text-[0.6875rem] font-semibold">
                            Next up
                          </span>
                        ) : null}
                      </span>
                      <span className="text-muted block text-[0.8125rem]">
                        {STATUSES.filter((s) => g.counts[s] > 0)
                          .map((s) => `${g.counts[s]} ${LABEL[s].toLowerCase()}`)
                          .join(' · ')}
                      </span>
                    </span>
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    {g.counts.queued > 0 && !isNext ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() =>
                          run(
                            `up|${key}`,
                            { action: 'queue.prioritise', brand: g.brand, month: g.month },
                            () => `${g.brand} ${monthName(g.month)} is next.`,
                          )
                        }
                      >
                        <ArrowUpToLine size={14} aria-hidden /> Run next
                      </Button>
                    ) : null}
                    {g.counts.failed + g.counts.needs_review > 0 ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy !== null}
                        onClick={() =>
                          run(
                            `retry|${key}`,
                            { action: 'queue.retry_group', brand: g.brand, month: g.month },
                            (r) => `${videos(num(r.retried))} put back in the queue.`,
                          )
                        }
                      >
                        <RotateCcw size={14} aria-hidden /> Retry failed
                      </Button>
                    ) : null}
                    {removable.length > 0 ? (
                      confirm === `all|${key}` ? (
                        <span className="flex items-center gap-2 text-[0.8125rem]">
                          Remove {videos(removable.length)}?
                          <Button
                            size="sm"
                            variant="secondary"
                            className="text-danger"
                            disabled={busy !== null}
                            onClick={() =>
                              run(
                                `rmall|${key}`,
                                { action: 'queue.remove_group', brand: g.brand, month: g.month },
                                (r) => `${videos(num(r.removed))} removed from the queue.`,
                              )
                            }
                          >
                            Remove
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                            Cancel
                          </Button>
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="secondary"
                          className="text-danger"
                          disabled={busy !== null}
                          onClick={() => setConfirm(`all|${key}`)}
                        >
                          <Trash2 size={14} aria-hidden /> Remove all
                        </Button>
                      )
                    ) : null}
                  </div>
                </div>

                {isOpen ? (
                  <div className="mt-3">
                    {pickedHere.length > 0 ? (
                      <div className="bg-surface-2 mb-2 flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-[0.8125rem]">
                        <span className="font-semibold">{pickedHere.length} selected</span>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="text-danger"
                          disabled={busy !== null}
                          onClick={() =>
                            run(
                              `rm|${key}`,
                              { action: 'queue.remove', ids: pickedHere.map((v) => v.id) },
                              (r) => `${videos(num(r.removed))} removed from the queue.`,
                            )
                          }
                        >
                          <Trash2 size={14} aria-hidden /> Remove selected
                        </Button>
                        {pickedHere.some((v) => v.status === 'failed' || v.status === 'needs_review') ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy !== null}
                            onClick={() =>
                              run(
                                `rt|${key}`,
                                { action: 'queue.retry', ids: pickedHere.map((v) => v.id) },
                                (r) => `${videos(num(r.retried))} put back in the queue.`,
                              )
                            }
                          >
                            <RotateCcw size={14} aria-hidden /> Retry selected
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                          Clear
                        </Button>
                      </div>
                    ) : null}

                    <ul className="max-h-72 divide-y divide-[color:var(--wx-border)] overflow-y-auto">
                      {vids.map((v) => (
                        <li key={v.id} className="flex items-start gap-3 py-2 text-[0.8125rem]">
                          <input
                            type="checkbox"
                            className="mt-1 size-4 shrink-0"
                            checked={picked.has(v.id)}
                            disabled={!REMOVABLE.includes(v.status) || busy !== null}
                            onChange={() => setPicked((p) => toggle(p, v.id))}
                            aria-label={`Select the video by ${v.creator ?? 'an unnamed creator'}`}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold">{v.creator ?? 'Unnamed creator'}</span>
                              <span className={cn('rounded-full px-2 py-0.5 text-[0.6875rem]', PILL[v.status])}>
                                {LABEL[v.status]}
                              </span>
                              {v.attempts > 0 && PENDING.includes(v.status) ? (
                                <span className="text-muted">tried {v.attempts}×</span>
                              ) : null}
                              <a
                                href={v.video_url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="text-accent ml-auto inline-flex items-center gap-1 hover:underline"
                                aria-label="Open the video in a new tab"
                              >
                                Open <ExternalLink size={12} aria-hidden />
                              </a>
                            </div>
                            {v.status === 'filed' && v.angle ? (
                              <p className="text-muted mt-0.5 break-words">Angle: {v.angle}</p>
                            ) : null}
                            {v.last_error ? (
                              <p className="text-muted mt-0.5 line-clamp-2 break-words">{v.last_error}</p>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                    {g.counts.sent > 0 ? (
                      <p className="text-muted mt-2 text-[0.75rem]">
                        Videos with the audit server cannot be removed until that batch finishes.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {data && data.historyTruncated ? (
          <p className="text-muted text-[0.75rem]">
            The counts above are exact. Only the most recent filed and skipped videos are listed.
          </p>
        ) : null}
        <p className="text-muted text-[0.75rem] leading-relaxed">
          Removing a video only takes it out of the queue. Categorise its brand again to queue it again.
          Filed and skipped videos are history and cannot be removed here.
        </p>
      </div>
    </Modal>,
    document.body,
  );
}
