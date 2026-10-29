import { useEffect, useRef, useState } from 'react';
import { ArchiveRestore, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Field, Input, PasswordInput } from '@/components/ui/Field';
import { getSupabase } from '@/lib/supabase';
import { restorePicturesFromFile, type PicturesRestored } from '@/lib/backup/client';
import {
  callBackup,
  daysAgo,
  formatWhen,
  FRIENDLY_TABLES,
  useBackupList,
  useRefreshBackups,
  type BackupRow,
  type RestoreResult,
  type RestoreRun,
} from '@/lib/admin/useBackups';
import { Modal, Notice } from './Modal';

/** A backup file the admin loaded in this visit, kept so its pictures can be restored too. */
export interface LoadedFile {
  bytes: Uint8Array;
  passphrase: string | null;
}

type Step = 'intro' | 'checking' | 'review' | 'restoring' | 'pictures' | 'done';

/**
 * Put a backup back, safely, in three beats:
 *
 *   1. CHECK. A rehearsal does every step of the restore and then undoes it, so
 *      the admin sees exactly what would change and whether it would work.
 *      A real restore cannot be started until a rehearsal of this backup has
 *      passed in this dialog.
 *   2. CONFIRM. The password again, and the word RESTORE typed.
 *   3. RESTORE. A safety copy of today's data is saved first, then everything is
 *      put back in one all-or-nothing step.
 *
 * Nothing here decides anything: the database does the work and the function
 * re-checks every rule, so a modified page cannot skip a step.
 */
export function RestoreDialog({
  backup,
  file,
  onClose,
}: {
  backup: BackupRow;
  file: LoadedFile | null;
  onClose: () => void;
}) {
  const list = useBackupList();
  const refresh = useRefreshBackups();
  const qc = useQueryClient();

  const [step, setStep] = useState<Step>('intro');
  const [accounts, setAccounts] = useState(true);
  const [withPictures, setWithPictures] = useState(Boolean(file));
  const [rehearsalId, setRehearsalId] = useState<string | null>(null);
  const [restoreId, setRestoreId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [typed, setTyped] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [pictures, setPictures] = useState<PicturesRestored | null>(null);
  const [pictureProgress, setPictureProgress] = useState('');

  const runs = list.data?.restores ?? [];
  const find = (id: string | null): RestoreRun | undefined => (id ? runs.find((r) => r.id === id) : undefined);
  const rehearsal = find(rehearsalId);
  const real = find(restoreId);
  // A run that is still going has an empty result object; only a finished rehearsal has tables.
  const result =
    rehearsal?.status === 'succeeded' && rehearsal.result?.tables ? (rehearsal.result as RestoreResult) : null;

  // The rehearsal finished: show what it found, or why it could not.
  useEffect(() => {
    if (step !== 'checking' || !rehearsal) return;
    if (rehearsal.status === 'succeeded') setStep('review');
    else if (rehearsal.status === 'failed') {
      setError(rehearsal.error ?? 'The check did not finish.');
      setStep('intro');
    }
  }, [step, rehearsal]);

  // The real restore finished: bring the pictures back if asked, then say so.
  const finishing = useRef(false);
  useEffect(() => {
    if (step !== 'restoring' || !real || finishing.current) return;
    if (real.status === 'failed') {
      finishing.current = true;
      setError(real.error ?? 'The restore did not finish. Nothing was changed.');
      setStep('review');
      finishing.current = false;
      return;
    }
    if (real.status !== 'succeeded') return;
    finishing.current = true;
    void (async () => {
      if (file && withPictures) {
        setStep('pictures');
        try {
          const put = async (bucket: string, path: string, token: string, bytes: Uint8Array, type: string) =>
            !(
              await getSupabase()
                .storage.from(bucket)
                .uploadToSignedUrl(path, token, new Blob([bytes as BlobPart], { type }), { contentType: type })
            ).error;
          setPictures(
            await restorePicturesFromFile(callBackup, put, file.bytes, file.passphrase, (p) =>
              setPictureProgress(`${p.phase}${p.total ? ` (${p.done ?? 0} of ${p.total})` : ''}`),
            ),
          );
        } catch {
          setPictures({ restored: 0, failed: ['all'], skipped: [] });
        }
      }
      // Everything the screens had cached is now out of date.
      await qc.invalidateQueries();
      setStep('done');
    })();
  }, [step, real, file, withPictures, qc]);

  const check = async () => {
    setStarting(true);
    setError('');
    try {
      const r = await callBackup({ action: 'backup.restore', backupId: backup.id, dryRun: true, accounts });
      setRehearsalId(String(r.restoreId));
      setStep('checking');
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not go through. Try again.');
    } finally {
      setStarting(false);
    }
  };

  const restore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (typed !== 'RESTORE' || !password) return;
    setStarting(true);
    setError('');
    try {
      const r = await callBackup({
        action: 'backup.restore',
        backupId: backup.id,
        dryRun: false,
        confirm: 'RESTORE',
        password,
        accounts,
      });
      setRestoreId(String(r.restoreId));
      setStep('restoring');
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through. Try again.');
    } finally {
      setStarting(false);
      setPassword('');
    }
  };

  const working = step === 'checking' || step === 'restoring' || step === 'pictures' || starting;
  const age = result ? daysAgo(result.backup.created_at) : 0;
  const changed = result ? result.tables.filter((t) => t.before !== t.restored).length : 0;

  const headline = result
    ? Object.entries(FRIENDLY_TABLES)
        .map(([id, label]) => {
          const t = result.tables.find((x) => x.id === id);
          return t ? { id, label, before: t.before, after: t.restored } : null;
        })
        .filter((x): x is { id: string; label: string; before: number; after: number } => x !== null)
    : [];

  return (
    <Modal
      title={step === 'done' ? 'Restore finished' : 'Restore this backup'}
      subtitle={
        step === 'done' ? null : (
          <>
            The backup from <strong>{formatWhen(backup.created_at)}</strong>
            {backup.note ? ` (${backup.note})` : ''}.
          </>
        )
      }
      onClose={onClose}
      busy={working}
      wide
    >
      {/* ------------------------------------------------------------ intro -- */}
      {step === 'intro' ? (
        <div className="grid gap-5">
          <Notice tone="info">
            <p className="font-semibold">First, a safe rehearsal.</p>
            <p className="mt-1">
              Prism does every step of the restore and then undoes it, so you can see exactly what would change
              before anything does. Nothing is changed. The app pauses for a few seconds while it checks.
            </p>
          </Notice>
          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={accounts}
              onChange={(e) => setAccounts(e.target.checked)}
              className="mt-1 size-5 shrink-0"
            />
            <span>
              <span className="font-semibold">Also restore the sign-in accounts (recommended)</span>
              <span className="text-muted block text-[0.8125rem]">
                Brings back every creator and admin login exactly as it was, passwords included, and removes
                accounts created since. Untick only if you want to keep today&apos;s accounts as they are.
              </span>
            </span>
          </label>
          {error ? <Notice tone="bad">{error}</Notice> : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void check()} disabled={starting}>
              {starting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RotateCcw size={16} aria-hidden />}
              Check this backup
            </Button>
          </div>
        </div>
      ) : null}

      {/* --------------------------------------------------------- checking -- */}
      {step === 'checking' ? (
        <div className="flex items-center gap-3 py-4 text-[0.9375rem]" role="status" aria-live="polite">
          <Loader2 size={20} className="animate-spin" aria-hidden />
          <span>
            {rehearsal?.phase ?? 'Rehearsing the restore'}…{' '}
            <span className="text-muted">Nothing is being changed. Keep this page open.</span>
          </span>
        </div>
      ) : null}

      {/* ----------------------------------------------------------- review -- */}
      {step === 'review' && result ? (
        <form onSubmit={restore} noValidate className="grid gap-5">
          <Notice tone="good">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 size={16} aria-hidden /> The rehearsal worked. This backup can be restored.
            </p>
            <p className="mt-1">
              {changed === 0
                ? 'Nothing would change: the database already matches this backup.'
                : `Restoring would change ${changed} of ${result.tables.length} tables.`}
            </p>
          </Notice>

          {age >= 1 ? (
            <Notice tone="warn">
              This backup is <strong>{age} day{age === 1 ? '' : 's'} old</strong>. Everything that happened since
              (new applications, videos, accounts, edits) will be lost from the live app. You can still get it back:
              Prism saves a copy of today&apos;s data first.
            </Notice>
          ) : null}

          <div>
            <h3 className="text-[0.9375rem] font-bold">What would change</h3>
            <ul className="divide-line mt-2 divide-y text-[0.875rem]">
              {headline.map((h) => (
                <li key={h.id} className="flex items-baseline justify-between gap-4 py-2">
                  <span>{h.label}</span>
                  <span className="wx-numeric font-mono">
                    {h.before.toLocaleString()}
                    <span className="text-faint"> now → </span>
                    <strong>{h.after.toLocaleString()}</strong>
                    <span className="text-faint"> in the backup</span>
                  </span>
                </li>
              ))}
              {result.accounts ? (
                <li className="flex items-baseline justify-between gap-4 py-2">
                  <span>Sign-in accounts</span>
                  <span className="wx-numeric text-right font-mono">
                    {result.accounts.restored.toLocaleString()} restored
                    {result.accounts.removed > 0 ? `, ${result.accounts.removed} removed` : ''}
                  </span>
                </li>
              ) : (
                <li className="text-muted py-2">Sign-in accounts: left exactly as they are.</li>
              )}
            </ul>
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="text-accent mt-2 min-h-11 text-[0.8125rem] underline underline-offset-4"
            >
              {showAll ? 'Hide' : 'Show'} every table ({result.tables.length})
            </button>
            {showAll ? (
              <ul className="text-muted max-h-56 overflow-y-auto text-[0.8125rem]">
                {result.tables.map((t) => (
                  <li key={t.id} className="flex justify-between gap-4 py-0.5">
                    <span className="min-w-0 truncate">{t.id}</span>
                    <span className="wx-numeric font-mono">
                      {t.before.toLocaleString()} → {t.restored.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {result.warnings.length > 0 ? (
            <Notice tone="warn">
              <p className="font-semibold">Worth knowing</p>
              <ul className="mt-1 list-disc pl-5">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          {result.schema.untouched.length > 0 ? (
            <p className="text-muted text-[0.8125rem]">
              Not in this backup, so left exactly as they are: {result.schema.untouched.join(', ')}.
            </p>
          ) : null}

          {file ? (
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={withPictures}
                onChange={(e) => setWithPictures(e.target.checked)}
                className="mt-1 size-5 shrink-0"
              />
              <span>
                <span className="font-semibold">Put the pictures in the file back too</span>
                <span className="text-muted block text-[0.8125rem]">
                  Logos and photos are put back over the same names. Nothing is deleted.
                </span>
              </span>
            </label>
          ) : null}

          <div className="border-line grid gap-4 border-t pt-5">
            <h3 className="text-[0.9375rem] font-bold">Confirm</h3>
            <Field label="Your password">
              {({ id }) => (
                <PasswordInput
                  id={id}
                  autoComplete="current-password"
                  value={password}
                  disabled={starting}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
            </Field>
            <Field label="Type the word RESTORE" hint="In capital letters.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={typed}
                  autoComplete="off"
                  disabled={starting}
                  onChange={(e) => setTyped(e.target.value)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <p className="text-muted text-[0.8125rem]">
              Before anything is replaced, Prism saves a copy of today&apos;s data in your list as &ldquo;Saved before
              a restore&rdquo;, so this can be undone. The app pauses briefly while it restores.
            </p>
            {error ? <Notice tone="bad">{error}</Notice> : null}
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="secondary"
                className="text-danger hover:text-danger"
                disabled={typed !== 'RESTORE' || !password || starting}
              >
                {starting ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <ArchiveRestore size={16} aria-hidden />}
                Restore now
              </Button>
            </div>
          </div>
        </form>
      ) : null}

      {/* -------------------------------------------------------- restoring -- */}
      {step === 'restoring' ? (
        <div className="grid gap-4 py-2" role="status" aria-live="polite">
          <div className="flex items-center gap-3 text-[0.9375rem]">
            <Loader2 size={20} className="animate-spin" aria-hidden />
            <span>{real?.phase ?? 'Starting'}…</span>
          </div>
          <Notice tone="warn">
            <strong>Keep this page open.</strong> The app pauses for a moment while the restore runs. If anything
            goes wrong, nothing is changed.
          </Notice>
        </div>
      ) : null}

      {step === 'pictures' ? (
        <div className="flex items-center gap-3 py-4 text-[0.9375rem]" role="status" aria-live="polite">
          <Loader2 size={20} className="animate-spin" aria-hidden />
          <span>{pictureProgress || 'Putting the pictures back'}…</span>
        </div>
      ) : null}

      {/* ------------------------------------------------------------- done -- */}
      {step === 'done' ? (
        <div className="grid gap-4">
          <Notice tone="good">
            <p className="flex items-center gap-2 font-semibold">
              <CheckCircle2 size={16} aria-hidden /> Everything was put back.
            </p>
            <p className="mt-1">
              The data is now exactly as it was on {formatWhen(backup.created_at)}.
              {pictures
                ? ` ${pictures.restored} pictures were put back${pictures.failed.length ? `, ${pictures.failed.length} could not be` : ''}.`
                : ''}
            </p>
          </Notice>
          {real?.safety_backup_id ? (
            <Notice tone="info">
              <strong>Changed your mind?</strong> A copy of what you had before is in your list as &ldquo;Saved before
              a restore&rdquo;. Restore that one to undo this.
            </Notice>
          ) : null}
          <p className="text-muted text-[0.8125rem]">
            Reload Prism so every screen shows the restored data. If you are asked to sign in again, use the same
            email and password as before.
          </p>
          <div className="flex justify-end">
            <Button onClick={() => window.location.reload()}>Reload Prism</Button>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
