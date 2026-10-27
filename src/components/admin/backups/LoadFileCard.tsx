import { useRef, useState } from 'react';
import { FileUp, Loader2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, PasswordInput } from '@/components/ui/Field';
import { BackupError, peekHeader } from '@/lib/backup/format';
import { uploadBackupFile, type Progress } from '@/lib/backup/client';
import { callBackup, useRefreshBackups } from '@/lib/admin/useBackups';
import type { LoadedFile } from './RestoreDialog';
import { Notice } from './Modal';

/**
 * Bring a backup file in from this computer.
 *
 * For a backup made earlier and kept elsewhere, or when moving to a brand new
 * project. The file is read here in the browser (unlocked here, if it has a
 * passphrase), checked, and sent to the database piece by piece. It then sits
 * in the list like any other backup, and is restored from there with the same
 * safe three-step dialog. Loading a file changes nothing by itself.
 */
export function LoadFileCard({ onLoaded }: { onLoaded: (backupId: string, file: LoadedFile) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const refresh = useRefreshBackups();
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; locked: boolean } | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const pick = async (f: File | undefined) => {
    setError('');
    setDone(false);
    if (!f) return;
    const bytes = new Uint8Array(await f.arrayBuffer());
    const header = peekHeader(bytes);
    if (!header) {
      setFile(null);
      setError('That is not a Prism backup file. Backup files end in .prismbackup.');
      return;
    }
    setFile({ name: f.name, bytes, locked: header.encrypted });
    setPassphrase('');
  };

  const load = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await uploadBackupFile(callBackup, file.bytes, file.locked ? passphrase : null, setProgress);
      onLoaded(res.backupId, { bytes: file.bytes, passphrase: file.locked ? passphrase : null });
      setDone(true);
      setFile(null);
      setPassphrase('');
      if (input.current) input.current.value = '';
      void refresh();
    } catch (err) {
      setError(
        err instanceof BackupError || err instanceof Error ? err.message : 'That did not go through. Try again.',
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <section className="wx-neo-raised rounded-xl p-5 sm:p-6" aria-labelledby="load-h">
      <h2 id="load-h" className="text-[1.0625rem] font-bold">
        Use a backup file from this computer
      </h2>
      <p className="text-muted mt-1 max-w-prose text-[0.875rem] leading-relaxed">
        Have a backup file from earlier, or from another Prism project? Load it here. It will appear in your list
        above, and you restore it from there. Loading a file changes nothing by itself.
      </p>

      <form onSubmit={load} noValidate className="mt-4 grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={input}
            id="backup-file"
            type="file"
            accept=".prismbackup,application/octet-stream"
            className="sr-only"
            onChange={(e) => void pick(e.target.files?.[0])}
            disabled={busy}
          />
          <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={busy}>
            <FileUp size={16} aria-hidden />
            Choose a backup file
          </Button>
          <span className="text-muted min-w-0 truncate text-[0.875rem]" aria-live="polite">
            {file ? (
              <>
                {file.locked ? <Lock size={13} className="mr-1 inline" aria-hidden /> : null}
                {file.name} ({(file.bytes.length / 1048576).toFixed(1)} MB)
              </>
            ) : (
              'No file chosen'
            )}
          </span>
        </div>

        {file?.locked ? (
          <Field label="Its passphrase" hint="This file is locked. Type the passphrase it was made with.">
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                autoComplete="off"
                value={passphrase}
                disabled={busy}
                onChange={(e) => setPassphrase(e.target.value)}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        ) : null}

        {error ? <Notice tone="bad">{error}</Notice> : null}
        {done ? (
          <Notice tone="good">
            Loaded. It is in your list now, labelled &ldquo;From a file&rdquo;. Press <strong>Restore</strong> on it
            when you are ready.
          </Notice>
        ) : null}

        {busy ? (
          <div className="flex items-center gap-3 text-[0.875rem]" role="status" aria-live="polite">
            <Loader2 size={18} className="animate-spin" aria-hidden />
            <span>
              {progress?.phase ?? 'Working'}
              {progress?.done ? ` (${progress.done} pieces)` : ''}… <span className="text-muted">Keep this page open.</span>
            </span>
          </div>
        ) : null}

        <div>
          <Button type="submit" disabled={!file || busy || (file.locked && passphrase.length === 0)}>
            Load this file
          </Button>
        </div>
      </form>
    </section>
  );
}
