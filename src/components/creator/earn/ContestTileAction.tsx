import { useState } from 'react';
import { Check, Clock, Gauge, Target, Trophy, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Field';
import { Note } from './EarnBits';
import {
  entryStateOf,
  useEnterContest,
  type ContestDoor,
  type CreatorContest,
} from '@/lib/creator/useCreatorContests';

/**
 * ONE BUTTON PER TILE: Join, Upload, or View. §8.1.
 *
 * LIFTED OUT OF `Contests.tsx` UNCHANGED IN BEHAVIOUR. The branch ORDER is load
 * bearing and is why this is its own file rather than inlined copy: the door is
 * decided LAST, after her own entry.
 *
 * "A CONTEST THAT IS SWITCHED OFF OR PAST ITS DEADLINE CLOSES THE DOOR, NEVER
 * THE WORK." If she holds an entry she still sees it, still delivers and still
 * gets paid, so `state === 'in'` is answered BEFORE the door is looked at. The
 * offers card shipped the other way round once: it asked what the offer said
 * about itself before asking what the creator had already been approved for,
 * and an admin flipping one switch hid the stage, the tracker and the money of
 * somebody already filming.
 *
 * THE LABELS ARE THE HOUSE WORDS, NOT THE SPEC'S SHORTHAND. "Enter this
 * contest" is Join and "Update progress" is Upload; both are asserted by
 * accessible name in `scripts/verify/creator/check-contests.mjs`, and renaming them would
 * break the only end-to-end proof this feature has.
 */
export function ContestTileAction({
  contest,
  door,
  canEnterAtAll,
  onEnter,
  onUpdateProgress,
}: {
  contest: CreatorContest;
  door: ContestDoor;
  /** False for staff, who may READ a contest but may never enter one. Rule E6. */
  canEnterAtAll: boolean;
  onEnter: () => void;
  onUpdateProgress: () => void;
}) {
  const state = entryStateOf(contest);
  const act = useEnterContest();
  const busy = act.isPending;
  const refusal = act.error ? (act.error as Error).message : '';

  if (state === 'in') {
    /*
     * UPDATE PROGRESS, offered while the contest can still take one. The
     * database refuses a claim on a settled or cancelled contest, and a button
     * whose only outcome is a refusal is the same bug as offering Withdraw once
     * work has been filed.
     *
     * IT SAYS SO WHEN SOMETHING IS ALREADY WAITING. Only one claim can be with
     * the team at a time, so the panel behind it has nothing to fill in in that
     * case, and a button that promised a form would be a dead end.
     */
    const open = !contest.settledAt && !contest.cancelledAt;

    return (
      <div className="flex flex-col gap-2">
        {/*
          THE DOOR AND THE WORK, SAID OUT LOUD. A shut deadline on a contest she
          is in has to be explained on the tile, not only implied by the fact
          that the tile is still there: she is looking at a contest that says
          "Closed" and has every reason to think her work no longer counts. It
          does.
        */}
        {open && door !== 'open' ? (
          <Note tone="quiet">
            Closed to new entries. Your work still pays what you were promised.
          </Note>
        ) : null}

        {open ? (
          <Button
            type="button"
            size="sm"
            className="w-full justify-center sm:w-auto"
            onClick={onUpdateProgress}
          >
            <Gauge size={15} aria-hidden />
            {contest.pendingClaim ? 'See what is with the team' : 'Update progress'}
          </Button>
        ) : (
          <Note tone="quiet">
            {door === 'cancelled'
              ? 'Called off.'
              : 'Settled.'}
          </Note>
        )}
        {contest.cancelMessage ? (
          <p className="text-muted text-[0.75rem] leading-relaxed">{contest.cancelMessage}</p>
        ) : null}
        {refusal ? (
          <p role="alert" className="text-danger text-[0.75rem]">
            {refusal}
          </p>
        ) : null}
      </div>
    );
  }

  if (state === 'waiting') {
    return (
      <div className="flex flex-col gap-2">
        <Note tone="waiting" icon={<Clock size={15} />}>
          <span className="font-semibold">With the team.</span>
        </Note>
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          disabled={busy}
          onClick={() => act.mutate({ action: 'contest.withdraw', entryId: contest.entry!.id })}
        >
          {busy ? 'Withdrawing...' : 'Withdraw'}
        </Button>
        {refusal ? (
          <p role="alert" className="text-danger text-[0.75rem]">
            {refusal}
          </p>
        ) : null}
      </div>
    );
  }

  if (state === 'declined') {
    return (
      <div className="flex flex-col gap-2">
        <Note tone="bad" icon={<X size={15} />}>
          <span className="font-semibold">Not this time.</span>
          {contest.entry?.decisionNote ? ` ${contest.entry.decisionNote}` : ''}
        </Note>
        {door === 'open' && canEnterAtAll ? (
          <Button variant="secondary" size="sm" className="self-start" onClick={onEnter}>
            Ask again
          </Button>
        ) : null}
      </div>
    );
  }

  if (state === 'withdrawn') {
    return (
      <div className="flex flex-col gap-2">
        <Note tone="quiet" icon={<Check size={15} />}>
          You pulled out.
        </Note>
        {door === 'open' && canEnterAtAll ? (
          <Button variant="secondary" size="sm" className="self-start" onClick={onEnter}>
            Enter after all
          </Button>
        ) : null}
      </div>
    );
  }

  /* -------------------------------------------- she is not in it at all -- */

  if (door !== 'open') {
    return (
      <Note tone="quiet">
        {door === 'cancelled'
          ? 'Called off.'
          : door === 'settled'
            ? 'Settled.'
            : 'Entries closed.'}
      </Note>
    );
  }

  /*
   * Staff, reading the product as a creator sees it. `assert_active_creator`
   * would refuse them, so this says why instead of handing them a button that
   * can only fail.
   */
  if (!canEnterAtAll) {
    return (
      <Note tone="quiet">
        Creator accounts only.
      </Note>
    );
  }

  return (
    <Button size="sm" className="w-full justify-center sm:w-auto" onClick={onEnter}>
      <Trophy size={15} aria-hidden />
      {contest.needsAdminApproval ? 'Ask to enter' : 'Enter this contest'}
    </Button>
  );
}

/* --------------------------------------------------------- how far along -- */

/**
 * What has happened to her videos, in one line.
 *
 * NO SECOND BAR. The deliverable bar on the tile face already draws a video
 * count against a target, and this counts the same videos through a different
 * lens: how many have been WATCHED. Two bars an inch apart, showing two
 * different numbers for what looks like one question, is the tile saying two
 * things at once.
 *
 * Every number here is about ONE person's entry, which is the property that
 * makes `contest_entry_progress` safe to read at all: a count over one
 * creator's own rows is complete rather than silently narrowed. Nothing here
 * knows another entrant exists.
 */
export function VideosFiled({
  progress,
}: {
  progress: NonNullable<CreatorContest['progress']>;
}) {
  const { approved, waiting, needsAnotherTake, posted } = progress;

  // Nothing filed is nothing to report, and a row of zeros would read as a
  // problem rather than as a beginning.
  if (posted === 0) return null;

  const parts: string[] = [];
  if (approved > 0) parts.push(`${approved} counted`);
  if (waiting > 0) parts.push(`${waiting} with the team`);
  if (needsAnotherTake > 0) parts.push(`${needsAnotherTake} to redo`);

  return (
    <p className="text-muted text-[0.8125rem]">
      <span className="text-text font-semibold">
        Your {posted === 1 ? 'video' : 'videos'}:{' '}
      </span>
      {parts.length > 0 ? parts.join(', ') : `${posted} sent`}
    </p>
  );
}

/* ------------------------------------------------------ their own number -- */

/**
 * The private target, and the one number in this feature that STAFF CANNOT
 * READ.
 *
 * It exists because every fact about other entrants is off this screen by
 * decision D7, so this is what is left to compete against. It lives in its own
 * table with one policy on it, the creator's own, and no staff policy of any
 * kind. `set_contest_entry_target` writes no audit row and no history row for
 * the same reason: both of those tables are staff readable, and a private
 * number with a trail somebody else can read is not private.
 *
 * The sentence under the box is therefore literally true, and it has to stay
 * that way. If this ever becomes visible to staff, the sentence is a lie told
 * by us, on our own screen, to the person whose transparency is the product.
 */
export function TargetControl({
  entryId,
  target,
}: {
  entryId: string;
  target: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(target === null ? '' : String(target));
  const [error, setError] = useState('');
  const act = useEnterContest();
  const busy = act.isPending;

  async function save(next: number | null) {
    setError('');
    try {
      await act.mutateAsync({ action: 'contest.target', entryId, target: next });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(target === null ? '' : String(target));
          setOpen(true);
        }}
        className="text-muted hover:text-accent ease-brand flex min-h-[2.75rem] w-full items-center gap-2 text-left text-[0.8125rem] transition-colors sm:min-h-0 sm:py-1 pointer-coarse:min-h-[2.75rem]"
      >
        <Target size={14} aria-hidden className="shrink-0" />
        {target === null ? (
          <span>Set yourself a target</span>
        ) : (
          <span>
            Your own target:{' '}
            <span className="text-text wx-numeric font-semibold">{target}</span> approved{' '}
            {target === 1 ? 'video' : 'videos'}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="wx-neo-inset rounded-xl px-3 py-3">
      <label
        htmlFor={`target-${entryId}`}
        className="text-muted block text-[0.8125rem] font-semibold"
      >
        Your own target
      </label>
      <div className="wx-tap-row mt-2.5 flex flex-wrap items-center gap-2">
        <Input
          id={`target-${entryId}`}
          inputMode="numeric"
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. 6"
          className="w-24 text-[0.875rem]"
        />
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => {
            const n = Number(value.trim());
            if (!Number.isInteger(n) || n < 1 || n > 1000) {
              setError('Give a whole number between 1 and 1000');
              return;
            }
            void save(n);
          }}
        >
          {busy ? 'Saving...' : 'Save'}
        </Button>
        {target !== null ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void save(null)}
          >
            Clear it
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setError('');
          }}
        >
          Cancel
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-danger mt-2 text-[0.75rem]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Pulling out, OFFERED ONLY WHILE THERE IS NOTHING TO LOSE.
 *
 * The database refuses once anything has been filed or awarded, with a sentence
 * saying so, and this hides the control in the same case rather than offering a
 * button whose only outcome is a refusal.
 */
export function WithdrawEntry({ contest }: { contest: CreatorContest }) {
  const act = useEnterContest();
  const busy = act.isPending;

  const canWithdraw =
    (contest.progress?.posted ?? 0) === 0 && !contest.settledAt && !contest.cancelledAt;
  if (!canWithdraw || !contest.entry) return null;

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => act.mutate({ action: 'contest.withdraw', entryId: contest.entry!.id })}
      >
        {busy ? 'Pulling out...' : 'Pull out of this one'}
      </Button>
      {act.error ? (
        <p role="alert" className="text-danger mt-2 text-[0.75rem]">
          {(act.error as Error).message}
        </p>
      ) : null}
    </div>
  );
}
