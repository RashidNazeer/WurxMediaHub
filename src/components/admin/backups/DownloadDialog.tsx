import { useState } from 'react';
import { Download, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Field, PasswordInput } from '@/components/ui/Field';
import { downloadBackupFile, type Progress } from '@/lib/backup/client';
import { callBackup, formatWhen, type BackupRow } from '@/lib/admin/useBackups';
import { Modal, Notice } from './Modal';

/**
 * Save a backup to THIS DEVICE as one file.
 *
 * Two ways in. With `backup` it saves one that already exists (the Download
 * button). With `newBackupNote` it is the "Back up now" button: it makes a fresh
 * backup, waits for it, and saves it to the device the button was pressed on, so
 * a copy always lands on the admin's own computer or phone, outside the database.
 *
 * The password is asked for again on purpose: a laptop left open must not be
 * enough to walk away with every account in the database. The optional
 * passphrase is used right here in the browser to lock the file; it is never
 * sent anywhere, which is why nobody, including us, can recover it.
 */
export function DownloadDialog({
  backup,
  newBackupNote,
  onClose,
}: {
  /** Save this existing backup. */
  backup?: BackupRow;
  /** Or make a new one first (the string is its optional name) and save that. */
  newBackupNote?: string | null;
  onClose: () => void;
}) {
  const making = !backup;
  const [password, setPassword] = useState('');
  const [lock, setLock] = useState(true);
  const [passphrase, setPassphrase] = useState('');
  const [again, setAgain] = useState('');
  const [pictures, setPictures] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState<{ name: string; size: number; pictures: number; locked: boolean } | null>(null);

  const phraseProblem =
    lock && passphrase.length > 0 && passphrase.length < 8
      ? 'A passphrase needs at least 8 characters.'
      : lock && again.length > 0 && again !== passphrase
        ? 'The two passphrases are not the same.'
        : '';
  const ready = password.length > 0 && (!lock || (passphrase.length >= 8 && again === passphrase));

  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError('');
    try {
      let backupId = backup?.id ?? '';
      let madeAt = backup?.created_at ?? new Date().toISOString();
      if (making) {
        // 1. make the backup (Postgres does the work); 2. wait until it is whole
        setProgress({ phase: 'Taking a snapshot of everything' });
        const created = await callBackup({ action: 'backup.create', note: newBackupNote?.trim() || null });
        backupId = String(created.backupId);
        const give = Date.now() + 15 * 60_000;
        for (;;) {
          await new Promise((r) => setTimeout(r, 1500));
          let row: BackupRow | undefined;
          try {
            row = ((await callBackup({ action: 'backup.list' })) as unknown as { backups: BackupRow[] }).backups.find((b) => b.id === backupId);
          } catch {
            /* the database can be busy for a moment: keep waiting */
          }
          if (row?.status === 'ready') {
            madeAt = row.created_at;
            break;
          }
          if (row?.status === 'failed') throw new Error(row.error ?? 'The backup did not finish. Nothing was changed.');
          if (Date.now() > give) throw new Error('The backup is taking very long. It carries on in the background: find it in your list in a few minutes and press Download.');
          if (row) setProgress({ phase: row.phase ?? 'Taking a snapshot of everything' });
        }
      }
      const result = await downloadBackupFile(callBackup, {
        backupId,
        password,
        passphrase: lock ? passphrase : null,
        withPictures: pictures,
        onProgress: setProgress,
      });
      const blob = new Blob([result.bytes as BlobPart], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      void madeAt;
      setSaved({ name: result.filename, size: result.bytes.length, pictures: result.pictures.count, locked: lock });
    } catch (err) {
      const m = err instanceof Error ? err.message : 'That did not go through. Try again.';
      setError(
        making
          ? `${m} If the backup itself was made, it is safe in your list: press Download on it to save a copy to this device.`
          : m,
      );
    } finally {
      setBusy(false);
      setProgress(null);
      setPassword('');
    }
  };

  return (
    <Modal
      title={making ? 'Back up now and save a copy to this device' : 'Download a backup'}
      subtitle={
        making
          ? 'Makes a fresh backup of everything, then saves it as one file on the device you are using right now. A copy outside the database is what protects you if the project is ever lost.'
          : `The backup from ${backup ? formatWhen(backup.created_at) : ''}, saved as one file on this device.`
      }
      onClose={onClose}
      busy={busy}
    >
      {saved ? (
        <div className="grid gap-4">
          <Notice tone="good">
            <p className="font-semibold">{making ? 'Backed up, and a copy is saved on this device: ' : 'Saved: '}{saved.name}</p>
            <p className="mt-1">
              {(saved.size / 1048576).toFixed(1)} MB
              {saved.pictures > 0 ? `, with ${saved.pictures} pictures` : ''}
              {saved.locked ? ', locked with your passphrase.' : '.'} Look in your Downloads folder.
            </p>
          </Notice>
          {saved.locked ? (
            <Notice tone="warn">
              <strong>Keep your passphrase somewhere safe.</strong> Nobody can recover it, not even us. Without it
              this file cannot be opened.
            </Notice>
          ) : (
            <Notice tone="warn">
              This file is <strong>not locked</strong>. Anyone who gets it can read every account in it. Keep it
              somewhere private.
            </Notice>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form onSubmit={go} noValidate className="grid gap-5">
          <Notice tone="info">
            A backup holds everything: every creator and admin account, their (scrambled) passwords, brands,
            offers, content and reports. Treat the file like a key to the whole business.
          </Notice>

          <Field label="Your password" hint="We ask again so nobody can take this from a screen you left open.">
            {({ id, describedBy }) => (
              <PasswordInput
                id={id}
                autoComplete="current-password"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby={describedBy}
              />
            )}
          </Field>

          <div className="grid gap-3">
            <label className="flex min-h-11 cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={lock}
                disabled={busy}
                onChange={(e) => setLock(e.target.checked)}
                className="mt-1 size-5 shrink-0"
              />
              <span>
                <span className="font-semibold">Lock the file with a passphrase (recommended)</span>
                <span className="text-muted block text-[0.8125rem]">
                  If the file is ever lost or sent to the wrong place, nobody can read it.
                </span>
              </span>
            </label>
            {lock ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Passphrase">
                  {({ id }) => (
                    <PasswordInput
                      id={id}
                      autoComplete="new-password"
                      value={passphrase}
                      disabled={busy}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="At least 8 characters"
                    />
                  )}
                </Field>
                <Field label="Type it again" error={phraseProblem}>
                  {({ id }) => (
                    <PasswordInput
                      id={id}
                      autoComplete="new-password"
                      value={again}
                      disabled={busy}
                      onChange={(e) => setAgain(e.target.value)}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </div>

          <label className="flex min-h-11 cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={pictures}
              disabled={busy}
              onChange={(e) => setPictures(e.target.checked)}
              className="mt-1 size-5 shrink-0"
            />
            <span>
              <span className="font-semibold">Include the pictures</span>
              <span className="text-muted block text-[0.8125rem]">
                Brand logos and creator photos live outside the database. Tick this to keep them in the file too.
              </span>
            </span>
          </label>

          {error ? <Notice tone="bad">{error}</Notice> : null}

          {busy ? (
            <div className="flex items-center gap-3 text-[0.875rem]" role="status" aria-live="polite">
              <Loader2 size={18} className="animate-spin" aria-hidden />
              <span>
                {progress?.phase ?? 'Working'}
                {progress?.total ? ` (${progress.done ?? 0} of ${progress.total})` : ''}
                {'… '}
                <span className="text-muted">Keep this page open.</span>
              </span>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || busy}>
              {lock ? <ShieldCheck size={16} aria-hidden /> : <Download size={16} aria-hidden />}
              {making ? 'Back up and save to this device' : 'Download'}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
