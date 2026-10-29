import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { m, useReducedMotion } from 'motion/react';
import { Archive, Loader2, Pencil, Plus, Target, Undo2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, Textarea } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import { money } from '@/lib/money';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { useManageContest } from '@/lib/admin/useManageContest';
import type { DeliverableType } from '@/components/work/DeliverableProgress';

/**
 * The deliverables on one contest.
 *
 * A CONTEST IS A LIST OF DELIVERABLES, redesigned by Rashid on 2026-08-13 and
 * written as SQL in `20260814010000_contest_deliverables_and_progress.sql`. One
 * deliverable is three things and nothing else: a TYPE, a TARGET the creator has
 * to reach, and the REWARD for reaching it. Add as many as the contest needs.
 *
 * PLACINGS ARE GONE. Nobody comes first, second or third. Anybody who reaches a
 * target earns its reward, and several creators can earn the same one, so there
 * is no uniqueness anywhere here and two live GMV rows on one contest is the
 * normal tiered case rather than a mistake: 500 pays 50, 1000 pays 120, and the
 * same person earns both on the way past.
 *
 * "How it is judged" is gone with them. These rows say what a creator has to do
 * in numbers, which is what that sentence was standing in for.
 *
 * THE TITLE IS TYPED BY THE ADMIN, EVERY TIME (decision Q11). Nothing here
 * generates one and a blank is refused, because those words are copied onto
 * every entrant's frozen promise and they have to be the admin's words.
 *
 * RETIRE, NEVER DELETE (rule F3). There is no delete function for a deliverable
 * in the database at all: once somebody holds frozen terms against a row, the
 * row is part of a promise and deleting it would leave the promise pointing at
 * nothing. A retired row stays here, dimmed, and bringing it back is the same
 * call that made it, sent active again.
 *
 * The editor is a POPUP, asked for in those words: Add deliverable opens a
 * panel, you pick the type, type the target, type the reward, and save. The list
 * underneath is the contest.
 *
 * THE FILE KEEPS ITS OLD NAME for one step only, so this rewrite is one diff
 * rather than a rename tangled up in it. Nothing a person reads says reward row
 * any more.
 */

/* ------------------------------------------------------------- vocabulary -- */

/** Rashid's words, and the only two types the database has today. */
const TYPE_LABEL: Record<DeliverableType, string> = {
  gmv: 'Generate GMV',
  video_count: 'Videos posted',
};

/*
 * Neutral, on purpose. Rule C1 keeps the three stage tokens for where one
 * creator's work and money have got to. A deliverable TYPE is neither: a GMV row
 * is not "due" and a video row is not "paid".
 */
const TYPE_CHIP = 'wx-neo-raised-sm text-muted';

/** A whole number of videos, grouped. Never money. */
const count = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '' : Math.round(value).toLocaleString();

/**
 * What this deliverable asks somebody to actually do, in one phrase.
 *
 * A GMV target reads as money in the contest's currency and a video target reads
 * as a count, which is the whole reason `type` is an enum rather than a label:
 * it decides how the same column is rendered.
 */
function askOf(type: DeliverableType, target: number | null, currency: string): string {
  if (target === null || !Number.isFinite(target)) return 'Target not set yet';
  if (type === 'video_count') {
    const n = Math.round(target);
    return n === 1 ? 'Post 1 video' : `Post ${count(n)} videos`;
  }
  return `Reach ${money(target, currency)} in GMV`;
}

/**
 * What it pays, in words rather than in zeroes.
 *
 * The database now requires a reward, and zero is legal and means an unpaid
 * deliverable. So a real 0 says so out loud, and only a missing figure reads
 * "Not set yet". Printing a currency formatted 0 for a row nobody has priced
 * would be a number standing in for a decision nobody has made.
 */
function paysOf(reward: number | null, currency: string): string {
  if (reward === null || !Number.isFinite(reward)) return 'Not set yet';
  if (reward === 0) return 'Pays nothing';
  return money(reward, currency);
}

/* ------------------------------------------------------------ reading in -- */

type Amount =
  { kind: 'empty' } | { kind: 'number'; value: number } | { kind: 'invalid'; message: string };

/**
 * Deliberately the same three answers as the budget box on the setup screen, for
 * the same reason: `Number('1,000')` is NaN, and treating that as "nothing was
 * typed" wipes a figure while showing a tick over the top of it.
 */
function readAmount(raw: string, noun: string, example: string): Amount {
  const t = raw.trim();
  if (!t) return { kind: 'empty' };

  const n = Number(t);
  if (!Number.isFinite(n)) {
    return { kind: 'invalid', message: `Give the ${noun} as a number, for example ${example}` };
  }
  if (n < 0) return { kind: 'invalid', message: `A ${noun} cannot be less than nothing` };
  if (n > 99_999_999)
    return { kind: 'invalid', message: `That ${noun} is larger than we can store` };
  return { kind: 'number', value: Math.round(n * 100) / 100 };
}

/** A whole number of videos the database will take: 1 to 1000, the column's bounds. */
function readWhole(raw: string): number | null {
  const t = raw.trim();
  if (!/^\d{1,4}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 1000 ? n : null;
}

/* ---------------------------------------------------------------- shapes -- */

/**
 * Enough of a deliverable to draw and edit one.
 *
 * Written as its own interface rather than imported from the admin contest hook
 * so this component states exactly what it needs, and so a row arriving from
 * anywhere with these five facts renders identically.
 */
interface DeliverableRow {
  id: string;
  type: DeliverableType;
  title: string;
  detail: string | null;
  /** What the creator has to reach. Money for gmv, a count for video_count. */
  targetValue: number | null;
  /** Required by the database. Zero is legal and means an unpaid deliverable. */
  rewardAmount: number | null;
  sortOrder: number;
  isActive: boolean;
}

/** Everything `deliverable.save` needs, already read out of the boxes. */
interface Parsed {
  id: string | null;
  type: DeliverableType;
  title: string;
  detail: string | null;
  targetValue: number;
  rewardAmount: number;
  sortOrder: number;
  isActive: boolean;
}

interface Draft {
  id: string | null;
  type: DeliverableType;
  title: string;
  detail: string;
  target: string;
  reward: string;
  sortOrder: number;
  isActive: boolean;
}

const draftFrom = (row: DeliverableRow): Draft => ({
  id: row.id,
  type: row.type,
  title: row.title,
  detail: row.detail ?? '',
  target: row.targetValue === null ? '' : String(row.targetValue),
  reward: row.rewardAmount === null ? '' : String(row.rewardAmount),
  sortOrder: row.sortOrder,
  isActive: row.isActive,
});

/*
 * NO TYPE IS PRE-PICKED beyond the first one in the list, and the target and the
 * reward start empty. Nothing writes a number for an admin here: the whole point
 * of the popup is that all three are typed on purpose.
 */
const blankDraft = (sortOrder: number): Draft => ({
  id: null,
  type: 'gmv',
  title: '',
  detail: '',
  target: '',
  reward: '',
  sortOrder,
  isActive: true,
});

interface Props {
  contestId: string;
  /** The contest's currency, for reading an amount back. Never converted. */
  currency: string;
  rows: DeliverableRow[];
  loading: boolean;
}

/* ------------------------------------------------------------------ list -- */

export function ContestDeliverables({ contestId, currency, rows, loading }: Props) {
  const manage = useManageContest();
  const [editing, setEditing] = useState<Draft | null>(null);
  /** Keyed by row, because a refusal belongs against the row it is about. */
  const [rowError, setRowError] = useState<Record<string, string>>({});

  const ordered = useMemo(() => {
    // Live work first, retired underneath, each in the order the admin set.
    return [...rows].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return a.sortOrder - b.sortOrder;
    });
  }, [rows]);

  const nextSortOrder = useMemo(() => {
    const highest = rows.reduce((max, r) => Math.max(max, r.sortOrder), 0);
    return Math.min(highest + 1, 9999);
  }, [rows]);

  const busy = manage.isPending;

  async function save(parsed: Parsed): Promise<string | null> {
    try {
      await manage.mutateAsync({
        action: 'deliverable.save',
        deliverableId: parsed.id,
        contestId,
        type: parsed.type,
        title: parsed.title,
        detail: parsed.detail,
        targetValue: parsed.targetValue,
        rewardAmount: parsed.rewardAmount,
        sortOrder: parsed.sortOrder,
        isActive: parsed.isActive,
      });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : 'That deliverable did not save';
    }
  }

  async function onRetire(row: DeliverableRow) {
    setRowError((e) => ({ ...e, [row.id]: '' }));
    try {
      await manage.mutateAsync({ action: 'deliverable.retire', deliverableId: row.id });
    } catch (err) {
      setRowError((e) => ({
        ...e,
        [row.id]: err instanceof Error ? err.message : 'That deliverable could not be retired',
      }));
    }
  }

  /** Bringing one back is the same call that made it, sent active again. */
  async function onRestore(row: DeliverableRow) {
    setRowError((e) => ({ ...e, [row.id]: '' }));

    if (row.targetValue === null || row.rewardAmount === null) {
      // Both are NOT NULL columns now, so this can only be a row written before
      // this shape existed. Saying so beats a constraint violation.
      setRowError((e) => ({
        ...e,
        [row.id]:
          'This one is missing its target or its reward. Open it and fill them in first.',
      }));
      return;
    }

    const message = await save({
      id: row.id,
      type: row.type,
      title: row.title,
      detail: row.detail,
      targetValue: row.targetValue,
      rewardAmount: row.rewardAmount,
      sortOrder: row.sortOrder,
      isActive: true,
    });
    if (message) setRowError((e) => ({ ...e, [row.id]: message }));
  }

  return (
    <section className="wx-neo-raised flex flex-col gap-4 rounded-xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div>
          <h2 className="text-muted text-[0.6875rem] font-semibold tracking-[0.14em] uppercase">
            Deliverables
          </h2>
          <p className="text-faint mt-1.5 max-w-prose text-[0.75rem]">
            What a creator has to reach, and what reaching it pays. Anybody who reaches a target
            earns its reward, and several creators can earn the same one. Every creator who
            enters is promised these exactly as they read on the day they enter.
          </p>
        </div>

        {ordered.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-[44px]"
            disabled={busy}
            onClick={() => setEditing(blankDraft(nextSortOrder))}
          >
            <Plus size={16} aria-hidden />
            Add deliverable
          </Button>
        ) : null}
      </div>

      {loading ? (
        <div className="flex flex-col gap-3">
          <div className="wx-skeleton h-[92px] rounded-xl" />
          <div className="wx-skeleton h-[92px] rounded-xl" />
        </div>
      ) : ordered.length === 0 ? (
        <div className="wx-neo-inset flex flex-col items-start gap-3 rounded-xl p-6">
          <div className="wx-neo-inset grid size-[44px] place-items-center rounded-lg">
            <Target size={19} className="text-muted" aria-hidden />
          </div>
          <h3 className="font-display text-text text-[1.1875rem] leading-tight font-bold">
            Nothing to reach yet
          </h3>
          <p className="text-muted max-w-prose text-[0.875rem] leading-relaxed">
            A deliverable is one promise: a number the creator has to reach, and what they get
            for reaching it. Add as many as this contest needs, and every creator who enters
            carries a frozen copy of them.
          </p>
          <Button
            type="button"
            disabled={busy}
            onClick={() => setEditing(blankDraft(nextSortOrder))}
          >
            <Plus size={16} aria-hidden />
            Add deliverable
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {ordered.map((row) => (
            <li key={row.id}>
              <DeliverableCard
                row={row}
                currency={currency}
                busy={busy}
                error={rowError[row.id] ?? ''}
                onEdit={() => {
                  setRowError((e) => ({ ...e, [row.id]: '' }));
                  setEditing(draftFrom(row));
                }}
                onRetire={() => void onRetire(row)}
                onRestore={() => void onRestore(row)}
              />
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <DeliverableDialog
          initial={editing}
          currency={currency}
          busy={busy}
          onClose={() => setEditing(null)}
          onSave={async (parsed) => {
            const message = await save(parsed);
            if (!message) setEditing(null);
            return message;
          }}
        />
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ card -- */

function DeliverableCard({
  row,
  currency,
  busy,
  error,
  onEdit,
  onRetire,
  onRestore,
}: {
  row: DeliverableRow;
  currency: string;
  busy: boolean;
  error: string;
  onEdit: () => void;
  onRetire: () => void;
  onRestore: () => void;
}) {
  const unpriced = row.rewardAmount === null;

  return (
    <div
      className={cn(
        'rounded-xl p-4',
        row.isActive
          ? 'wx-neo-raised'
          : 'wx-neo-inset opacity-70'
      )}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold tracking-[0.06em]',
                TYPE_CHIP
              )}
            >
              {TYPE_LABEL[row.type]}
            </span>
            <span className="text-muted font-mono text-[0.75rem]">
              {askOf(row.type, row.targetValue, currency)}
            </span>
            {!row.isActive ? (
              <span className="wx-neo-raised-sm text-muted rounded-full px-2 py-0.5 font-mono text-[0.625rem] tracking-[0.12em] uppercase">
                Retired
              </span>
            ) : null}
          </div>

          <p className="text-text mt-2 text-[0.9375rem] font-semibold break-words">
            {row.title}
          </p>

          {row.detail ? (
            <p className="text-muted mt-1 max-w-prose text-[0.8125rem] leading-relaxed break-words">
              {row.detail}
            </p>
          ) : null}
        </div>

        <div className="shrink-0">
          <span className="text-muted block text-[0.6875rem] font-semibold tracking-[0.14em] uppercase">
            Reward
          </span>
          <span
            className={cn(
              'wx-numeric font-display mt-0.5 block text-[1.0625rem] font-bold',
              unpriced ? 'text-faint' : 'text-text'
            )}
          >
            {paysOf(row.rewardAmount, currency)}
          </span>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-[44px]"
            disabled={busy}
            onClick={onEdit}
          >
            <Pencil size={15} aria-hidden />
            Edit
          </Button>
          {row.isActive ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-[44px]"
              disabled={busy}
              onClick={onRetire}
            >
              <Archive size={15} aria-hidden />
              Retire
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-[44px]"
              disabled={busy}
              onClick={onRestore}
            >
              <Undo2 size={15} aria-hidden />
              Bring it back
            </Button>
          )}
        </div>
      </div>

      {!row.isActive ? (
        <p className="text-faint mt-3 max-w-prose text-[0.75rem] leading-relaxed">
          A retired deliverable is off the contest for anybody entering from now on. Every
          creator who was already promised this one still holds it, and is still paid for it.
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="bg-danger-soft text-danger mt-3 rounded-xl px-3 py-2 text-[0.8125rem] font-medium"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------- popup --- */

type EditorErrors = Partial<Record<'title' | 'target' | 'reward', string>>;

function DeliverableDialog({
  initial,
  currency,
  busy,
  onClose,
  onSave,
}: {
  initial: Draft;
  currency: string;
  busy: boolean;
  onClose: () => void;
  /** Returns the refusal to print in the panel, or null when it went through. */
  onSave: (parsed: Parsed) => Promise<string | null>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // The type select, not the close button: a keyboard user opening this should
  // land on the first decision rather than on the exit.
  useFocusTrap(panelRef, { initialSelector: '[aria-haspopup="listbox"]' });

  const reduced = useReducedMotion();
  const [values, setValues] = useState<Draft>(initial);
  const [errors, setErrors] = useState<EditorErrors>({});
  const [serverError, setServerError] = useState('');

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setValues((d) => ({ ...d, [k]: v }));
    setServerError('');
    setErrors((e) => {
      if (!(k in e)) return e;
      const next = { ...e };
      delete next[k as keyof EditorErrors];
      return next;
    });
  };

  // Escape closes it, unless something is in flight: pulling the panel out from
  // under a request in progress leaves nowhere for the answer to land.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, onClose]);

  const isVideos = values.type === 'video_count';

  /**
   * The deal in one sentence, before it is saved.
   *
   * The same idiom the offer dialog uses, and it earns its place twice here: it
   * is where an admin catches a trailing zero on a target, and it is the only
   * place the two numbers are read together in the order a creator meets them.
   */
  const summary = (() => {
    let targetValue: number | null;
    if (isVideos) {
      targetValue = readWhole(values.target);
    } else {
      const read = readAmount(values.target, 'target', '500');
      targetValue = read.kind === 'number' && read.value > 0 ? read.value : null;
    }

    const reward = readAmount(values.reward, 'reward', '250');
    if (targetValue === null || reward.kind === 'invalid') return null;

    const ask = askOf(values.type, targetValue, currency);

    if (reward.kind === 'empty') return `${ask}. What does that pay?`;
    if (reward.value === 0) return `${ask}, and it pays nothing.`;
    return `${ask}, earn ${money(reward.value, currency)}.`;
  })();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: EditorErrors = {};

    const title = values.title.trim();
    if (!title) next.title = 'Give this deliverable a short name';

    let targetValue: number | null = null;

    if (isVideos) {
      targetValue = readWhole(values.target);
      if (targetValue === null) {
        next.target = values.target.trim()
          ? 'Give a whole number of videos, 1 to 1000'
          : 'How many videos does this ask for?';
      }
    } else {
      const read = readAmount(values.target, 'target', '500');
      if (read.kind === 'empty') next.target = 'What GMV do they have to reach?';
      else if (read.kind === 'invalid') next.target = read.message;
      else if (read.value <= 0) next.target = 'A target has to be above zero';
      else if (read.value > 100_000_000)
        next.target = `A GMV target of ${read.value} looks like a typo`;
      else targetValue = read.value;
    }

    // REQUIRED NOW, and zero is a real answer. A deliverable is "reach this,
    // earn that", so a reward nobody has decided is half a promise.
    const reward = readAmount(values.reward, 'reward', '250');
    if (reward.kind === 'empty') {
      next.reward = 'What does this pay? Type 0 if it pays nothing';
    } else if (reward.kind === 'invalid') {
      next.reward = reward.message;
    }

    if (Object.keys(next).length > 0 || targetValue === null || reward.kind !== 'number') {
      setErrors(next);
      return;
    }
    setErrors({});

    const message = await onSave({
      id: values.id,
      type: values.type,
      title,
      detail: values.detail.trim() || null,
      targetValue,
      rewardAmount: reward.value,
      sortOrder: values.sortOrder,
      isActive: values.isActive,
    });

    if (message) setServerError(message);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={values.id ? 'Edit deliverable' : 'Add a deliverable'}
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6"
    >
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={() => !busy && onClose()}
        className="fixed inset-0 cursor-default bg-black/60 backdrop-blur-sm"
      />

      <m.div
        ref={panelRef}
        initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={reduced ? { duration: 0 } : { duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="wx-neo-raised relative max-h-[100dvh] w-full max-w-xl overflow-y-auto rounded-t-2xl p-6 sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="font-display text-text text-[1.3125rem] leading-tight font-bold">
              {values.id ? 'Edit deliverable' : 'Add a deliverable'}
            </h2>
            <p className="text-muted mt-1 text-[0.875rem] leading-relaxed">
              Pick what it asks for, type the target, type what reaching it pays.
            </p>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose()}
            aria-label="Close"
            className="text-muted hover:text-accent -mt-1 -mr-1 grid size-[44px] shrink-0 place-items-center rounded-lg transition-colors"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} noValidate aria-busy={busy} className="mt-6">
          <div className="grid gap-5">
            <Field label="What it asks for">
              {({ id, describedBy, invalid }) => (
                <Select
                  id={id}
                  name="type"
                  value={values.type}
                  onChange={(e) => set('type', e.target.value as DeliverableType)}
                  disabled={busy}
                  aria-describedby={describedBy}
                  invalid={invalid}
                >
                  <option value="gmv">{TYPE_LABEL.gmv}</option>
                  <option value="video_count">{TYPE_LABEL.video_count}</option>
                </Select>
              )}
            </Field>

            <Field
              label="Name"
              error={errors.title}
              hint="Your words. Nothing writes this for you, and every entrant reads it."
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  name="title"
                  value={values.title}
                  onChange={(e) => set('title', e.target.value)}
                  maxLength={160}
                  disabled={busy}
                  placeholder={
                    isVideos ? 'e.g. Three in-feed videos' : 'e.g. First 500 in sales'
                  }
                  aria-describedby={describedBy}
                  invalid={invalid}
                />
              )}
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field
                label={isVideos ? 'Videos to post' : `Target GMV, ${currency}`}
                error={errors.target}
                hint={
                  isVideos
                    ? 'A whole number of videos, 1 to 1000.'
                    : `The number they have to reach, in ${currency}.`
                }
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    name="target"
                    inputMode={isVideos ? 'numeric' : 'decimal'}
                    value={values.target}
                    onChange={(e) => set('target', e.target.value)}
                    disabled={busy}
                    placeholder={isVideos ? 'e.g. 3' : 'e.g. 500'}
                    aria-describedby={describedBy}
                    invalid={invalid}
                  />
                )}
              </Field>

              <Field
                label={`Reward, ${currency}`}
                error={errors.reward}
                hint="What reaching it pays. Type 0 for a deliverable that pays nothing."
              >
                {({ id, describedBy, invalid }) => (
                  <Input
                    id={id}
                    name="reward"
                    inputMode="decimal"
                    value={values.reward}
                    onChange={(e) => set('reward', e.target.value)}
                    disabled={busy}
                    placeholder="e.g. 250"
                    aria-describedby={describedBy}
                    invalid={invalid}
                  />
                )}
              </Field>
            </div>

            <Field
              label="Detail"
              hint="Optional. Anything a creator needs to know about this one."
            >
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  name="detail"
                  value={values.detail}
                  onChange={(e) => set('detail', e.target.value)}
                  rows={2}
                  maxLength={1000}
                  disabled={busy}
                  placeholder="e.g. Parent facing, filmed at home, no music over the voiceover."
                  aria-describedby={describedBy}
                  invalid={invalid}
                />
              )}
            </Field>

            {/* Announced, because it is the sentence that catches a trailing zero. */}
            <p
              aria-live="polite"
              className={cn(
                'rounded-xl px-4 py-3 text-[0.8125rem] leading-relaxed',
                summary ? 'wx-neo-inset text-text font-medium' : 'text-faint'
              )}
            >
              {summary ?? 'Fill in the target and the reward, and the deal reads here.'}
            </p>

            {/*
              The refusal an edit is most likely to meet, and it is a good one:
              once anybody holds a frozen promise, the type, the target and the
              reward on an existing deliverable are what they agreed to.
            */}
            {values.id ? (
              <p className="text-faint max-w-prose text-[0.75rem] leading-relaxed">
                If somebody has already been promised this one, its type, target and reward
                cannot change. Add another deliverable instead, or retire this one. Both are
                always allowed.
              </p>
            ) : null}

            {serverError ? (
              <p
                role="alert"
                className="bg-danger-soft text-danger rounded-xl px-3 py-2 text-[0.8125rem] font-medium"
              >
                {serverError}
              </p>
            ) : null}
          </div>

          <div className="mt-7 flex flex-wrap gap-2.5">
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : null}
              {values.id ? 'Save deliverable' : 'Add deliverable'}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
      </m.div>
    </div>
  );
}
