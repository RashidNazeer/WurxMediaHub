import { useState } from 'react';
import {
  AlertTriangle,
  ArchiveRestore,
  CheckCircle2,
  DatabaseBackup,
  Download,
  Loader2,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Field';
import { cn } from '@/lib/utils';
import {
  callBackup,
  formatBytes,
  formatWhen,
  KIND_LABEL,
  useBackupList,
  useRefreshBackups,
  type BackupRow,
  type RestoreRun,
} from '@/lib/admin/useBackups';
import { DownloadDialog } from '@/components/admin/backups/DownloadDialog';
import { RestoreDialog, type LoadedFile } from '@/components/admin/backups/RestoreDialog';
import { LoadFileCard } from '@/components/admin/backups/LoadFileCard';
import { Notice } from '@/components/admin/backups/Modal';

/**
 * Data → Backup data. Admin only.
 *
 * A backup is a copy of EVERYTHING in the database: every creator and admin
 * account (with their locked passwords), brands, offers, content, contests,
 * reports and Paid Collabs. It can be put back, in one all-or-nothing step,
 * whenever it is needed.
 *
 * WRITTEN FOR SOMEBODY WHO IS NOT A DATABASE PERSON. Rashid does not use a
 * terminal, and the day this screen matters is the worst day the business has
 * had, so every sentence says what will happen in the words he would use, and
 * the dangerous step (Restore) cannot be reached without a rehearsal, his
 * password and a typed word. See supabase/functions/backup-data for the rules
 * the server enforces whatever this page does.
 *
 * The screen draws no title and no description of itself: the top bar names
 * the section, and row one is the work.
 */
export function Backups() {
  const list = useBackupList();
  const refresh = useRefreshBackups();

  const [note, setNote] = useState('');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [download, setDownload] = useState<BackupRow | null>(null);
  /** The "Back up now" dialog: makes the backup AND saves a copy to this device. */
  const [backupHere, setBackupHere] = useState(false);
  const [restore, setRestore] = useState<BackupRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [shown, setShown] = useState(10);
  /** Files loaded this visit, kept so their pictures can be restored with them. */
  const [files, setFiles] = useState<Record<string, LoadedFile>>({});

  const backups = list.data?.backups ?? [];
  const restores = list.data?.restores ?? [];
  const running = backups.find((b) => b.status === 'running' && b.kind !== 'uploaded');
  const restoring = restores.find((r) => r.status === 'running');
  const lastGood = backups.find((b) => b.status === 'ready' && b.kind === 'manual');
  const stale = !lastGood || Date.now() - new Date(lastGood.created_at).getTime() > 7 * 86_400_000;

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    setError('');
    try {
      await callBackup({ action: 'backup.create', note: note.trim() || null });
      setNote('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not go through. Try again.');
    } finally {
      setStarting(false);
    }
  };

  const remove = async (id: string) => {
    setDeleteError('');
    try {
      await callBackup({ action: 'backup.delete', backupId: id });
      setConfirmDelete(null);
      setFiles((f) => {
        const { [id]: _gone, ...rest } = f;
        return rest;
      });
      await refresh();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'That did not go through. Try again.');
    }
  };

  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <Notice tone={stale ? 'warn' : 'info'}>
        <p className="flex items-start gap-2">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            <strong>Keep a copy somewhere else.</strong> Backups made here are stored in the same database as your
            data, so if the whole project were ever lost they would go with it. Press <em>Download</em> on one now
            and then, and keep the file on a drive or in cloud storage you trust.
            {!lastGood
              ? ' You have not made a backup yet.'
              : stale
                ? ` Your last backup was ${formatWhen(lastGood.created_at)}.`
                : ''}
          </span>
        </p>
      </Notice>

      {/* --------------------------------------------------- make a backup -- */}
      <section className="wx-neo-raised rounded-xl p-5 sm:p-6" aria-labelledby="make-h">
        <h2 id="make-h" className="text-[1.0625rem] font-bold">
          Back up everything
        </h2>
        <p className="text-muted mt-1 max-w-prose text-[0.875rem] leading-relaxed">
          Makes a copy of everything in Prism as it is right now: every creator and admin account, brands, offers,
          videos, contests, reports and Paid Collabs. It usually takes under a minute and nobody is interrupted.
        </p>

        {running ? (
          <div className="mt-4 flex items-center gap-3 text-[0.9375rem]" role="status" aria-live="polite">
            <Loader2 size={20} className="animate-spin" aria-hidden />
            <span>
              {running.phase ?? 'Working'}… <span className="text-muted">You can leave this page; it carries on.</span>
            </span>
          </div>
        ) : restoring ? (
          <p className="text-muted mt-4 text-[0.875rem]">A restore is running. A new backup can start when it is done.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setBackupHere(true);
            }}
            noValidate
            className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end"
          >
            <Field label="Name this backup (optional)" hint="Something that will help you find it later.">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  value={note}
                  maxLength={200}
                  placeholder="e.g. Before the October launch"
                  disabled={starting}
                  onChange={(e) => setNote(e.target.value)}
                  aria-describedby={describedBy}
                />
              )}
            </Field>
            <div className="sm:pb-7">
              <Button type="submit" size="lg" disabled={starting}>
                <DatabaseBackup size={16} aria-hidden />
                Back up now
              </Button>
            </div>
            <p className="text-muted text-[0.8125rem] sm:col-span-2">
              This backs up and saves a copy on <strong>the device you are using</strong>.{' '}
              <button
                type="button"
                onClick={(e) => void start(e)}
                disabled={starting}
                className="text-accent min-h-11 underline underline-offset-4"
              >
                Back up inside Prism only
              </button>
            </p>
          </form>
        )}
        {error ? <Notice tone="bad" className="mt-4">{error}</Notice> : null}
      </section>

      {/* ----------------------------------------------------- the backups -- */}
      <section aria-labelledby="list-h">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="list-h" className="text-[1.0625rem] font-bold">
            Your backups
          </h2>
          {list.data ? (
            <span className="text-faint text-[0.8125rem]">
              {formatBytes(list.data.stored_bytes)} of database space used by backups
            </span>
          ) : null}
        </div>

        {list.isLoading ? (
          <ul className="grid gap-3">
            {[0, 1].map((i) => (
              <li key={i} className="wx-neo-raised rounded-xl p-5">
                <div className="wx-skeleton h-5 w-56 rounded" />
                <div className="wx-skeleton mt-3 h-4 w-80 max-w-full rounded" />
              </li>
            ))}
          </ul>
        ) : list.isError ? (
          <Notice tone="bad">
            {list.error instanceof Error ? list.error.message : 'The list would not load.'} If this says the tools are
            not set up, the database update for backups has not been applied yet.
          </Notice>
        ) : backups.length === 0 ? (
          <div className="wx-neo-raised rounded-xl px-6 py-12 text-center">
            <DatabaseBackup size={26} aria-hidden className="text-faint mx-auto" />
            <p className="mt-4 font-semibold">No backups yet</p>
            <p className="text-muted mx-auto mt-2 max-w-sm text-[0.875rem] leading-relaxed">
              Press <em>Back up now</em> above to make your first one.
            </p>
          </div>
        ) : (
          <ul className="grid gap-3">
            {backups.slice(0, shown).map((b) => (
              <li key={b.id} className="wx-neo-raised rounded-xl p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[1rem] font-bold">{formatWhen(b.created_at)}</span>
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold',
                          b.kind === 'before_restore' ? 'bg-warning-soft text-warning' : 'bg-surface-2 text-muted',
                        )}
                      >
                        {KIND_LABEL[b.kind]}
                      </span>
                    </p>
                    {b.note ? <p className="mt-1 text-[0.9375rem]">{b.note}</p> : null}
                    {b.status === 'ready' ? (
                      <p className="text-muted mt-1 text-[0.8125rem]">
                        {b.total_rows.toLocaleString()} records · {Object.keys(b.row_counts).length} tables ·{' '}
                        {formatBytes(b.size_bytes)}
                        {b.created_by_email ? ` · by ${b.created_by_email}` : ''}
                      </p>
                    ) : b.status === 'running' ? (
                      <p className="text-muted mt-1 flex items-center gap-2 text-[0.8125rem]">
                        <Loader2 size={14} className="animate-spin" aria-hidden /> {b.phase ?? 'Working'}…
                      </p>
                    ) : (
                      <p className="text-danger mt-1 text-[0.8125rem]">
                        This one did not finish. {b.error ?? ''} Nothing was changed.
                      </p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {b.status === 'ready' ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setDownload(b)}>
                          <Download size={15} aria-hidden />
                          Download
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setRestore(b)}>
                          <ArchiveRestore size={15} aria-hidden />
                          Restore
                        </Button>
                      </>
                    ) : null}
                    {b.status !== 'running' ? (
                      confirmDelete === b.id ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[0.8125rem] font-semibold">Delete it?</span>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="text-danger hover:text-danger"
                            onClick={() => void remove(b.id)}
                          >
                            Yes, delete
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                            Keep
                          </Button>
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(b.id)} aria-label={`Delete the backup from ${formatWhen(b.created_at)}`}>
                          <Trash2 size={15} aria-hidden />
                          Delete
                        </Button>
                      )
                    ) : null}
                  </div>
                </div>
                {confirmDelete === b.id && deleteError ? (
                  <p role="alert" className="text-danger mt-3 text-[0.8125rem]">
                    {deleteError}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {backups.length > shown ? (
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" onClick={() => setShown((n) => n + 10)}>
              Show older backups ({backups.length - shown} more)
            </Button>
          </div>
        ) : null}
      </section>

      <LoadFileCard onLoaded={(id, f) => setFiles((cur) => ({ ...cur, [id]: f }))} />

      {/* ------------------------------------------------------- the history -- */}
      {restores.length > 0 ? (
        <section aria-labelledby="hist-h">
          <h2 id="hist-h" className="mb-3 text-[1.0625rem] font-bold">
            Recent restores and checks
          </h2>
          <ul className="wx-neo-raised divide-line divide-y overflow-hidden rounded-xl">
            {restores.slice(0, 8).map((r) => (
              <HistoryRow key={r.id} run={r} />
            ))}
          </ul>
        </section>
      ) : null}

      {download ? <DownloadDialog backup={download} onClose={() => setDownload(null)} /> : null}
      {backupHere ? (
        <DownloadDialog
          newBackupNote={note}
          onClose={() => {
            setBackupHere(false);
            setNote('');
            void refresh();
          }}
        />
      ) : null}
      {restore ? (
        <RestoreDialog backup={restore} file={files[restore.id] ?? null} onClose={() => setRestore(null)} />
      ) : null}
    </div>
  );
}

function HistoryRow({ run }: { run: RestoreRun }) {
  const what = run.dry_run ? 'Rehearsal (nothing changed)' : 'Restore';
  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 text-[0.875rem] sm:px-5">
      <span className="flex items-center gap-2 font-medium">
        {run.status === 'succeeded' ? (
          <CheckCircle2 size={15} className="text-success" aria-hidden />
        ) : run.status === 'running' ? (
          <Loader2 size={15} className="animate-spin" aria-hidden />
        ) : (
          <AlertTriangle size={15} className="text-danger" aria-hidden />
        )}
        {what}
        {run.status === 'succeeded' ? ' worked' : run.status === 'running' ? ' is running' : ' did not finish'}
      </span>
      <span className="text-muted text-[0.8125rem]">
        {formatWhen(run.started_at)}
        {run.started_by_email ? ` · ${run.started_by_email}` : ''}
      </span>
      {run.status === 'failed' && run.error ? (
        <span className="text-danger basis-full text-[0.8125rem]">{run.error}</span>
      ) : null}
    </li>
  );
}
