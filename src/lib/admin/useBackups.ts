import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import type { Call } from '@/lib/backup/client';

/**
 * The "Backup data" screen's one door to the `backup-data` Edge Function, and
 * the list of backups it keeps fresh.
 *
 * The function answers in plain words when it refuses ("That password is not
 * right.", "Type RESTORE to confirm."). `functions.invoke` hides those behind a
 * generic "non-2xx" message, so they are pulled back out here, the same way
 * every other admin write does. A 503 means the database is busy for a moment
 * (a restore holds it briefly); that is a pause, never an error to show.
 */

export type BackupKind = 'manual' | 'before_restore' | 'uploaded';
export type JobStatus = 'running' | 'ready' | 'failed';

export interface BackupRow {
  id: string;
  created_at: string;
  finished_at: string | null;
  kind: BackupKind;
  status: JobStatus;
  phase: string | null;
  note: string | null;
  size_bytes: number | null;
  total_rows: number;
  row_counts: Record<string, number>;
  created_by_email: string | null;
  error: string | null;
}

export interface RestoreTable {
  id: string;
  before: number;
  restored: number;
}

export interface RestoreResult {
  dry_run: boolean;
  tables: RestoreTable[];
  accounts: { restored: number; removed: number } | null;
  schema: { missingHere: string[]; untouched: string[]; droppedColumns: unknown[]; newColumns: unknown[] };
  warnings: string[];
  backup: {
    created_at: string;
    total_rows: number;
    profile_roles: Record<string, number>;
    server_version: string | null;
    same_shape: boolean;
  };
}

export interface RestoreRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  started_by_email: string | null;
  backup_id: string | null;
  dry_run: boolean;
  status: JobStatus | 'succeeded';
  phase: string | null;
  safety_backup_id: string | null;
  result: Partial<RestoreResult>;
  error: string | null;
}

interface BackupList {
  backups: BackupRow[];
  restores: RestoreRun[];
  stored_bytes: number;
}

/** A refusal from the function, carrying its words and the flags the screen reacts to. */
class BackupCallError extends Error {
  readonly status: number;
  readonly busy: boolean;
  readonly needsPassphrase: boolean;
  constructor(message: string, status: number, busy: boolean, needsPassphrase: boolean) {
    super(message);
    this.name = 'BackupCallError';
    this.status = status;
    this.busy = busy;
    this.needsPassphrase = needsPassphrase;
  }
}

/** The one door. Resolves with the answer, or throws a BackupCallError in plain words. */
export const callBackup: Call = async (body) => {
  const { data, error } = await getSupabase().functions.invoke('backup-data', { body });
  if (!error) return (data ?? {}) as Record<string, unknown>;

  let message = '';
  let status = 0;
  let busy = false;
  let needsPassphrase = false;
  const context = (error as { context?: Response }).context;
  if (context && typeof context.json === 'function') {
    status = context.status;
    try {
      const b = (await context.json()) as { error?: string; busy?: boolean; needsPassphrase?: boolean };
      message = b.error ?? '';
      busy = Boolean(b.busy);
      needsPassphrase = Boolean(b.needsPassphrase);
    } catch {
      // Not JSON. Fall through to the generic message.
    }
  }
  if (!message) {
    if (!context) {
      // No answer at all. When the function does not exist on the project, the browser's own
      // safety check rejects the request before it is sent, so this is what that looks like.
      message =
        'Prism could not reach the backup service. If backups have not been set up on this project yet, ' +
        'the database update and the "backup-data" function still have to be deployed (see docs/BACKUPS.md). ' +
        'Otherwise check your connection and try again. Nothing was changed.';
    } else if (status === 404) {
      message = 'The backup tools are not set up on this server yet. Ask whoever manages Prism to deploy them.';
    } else {
      message = 'That did not go through. Nothing was changed. Try again in a moment.';
    }
  }
  throw new BackupCallError(message, status, busy, needsPassphrase);
};

const BACKUPS_KEY = ['admin', 'backups'] as const;

/**
 * The backups and restore runs. Polls quickly while something is running, and
 * quietly the rest of the time; a "busy" answer just keeps the last good data.
 */
export function useBackupList() {
  return useQuery({
    queryKey: BACKUPS_KEY,
    queryFn: async (): Promise<BackupList> => (await callBackup({ action: 'backup.list' })) as unknown as BackupList,
    refetchInterval: (query) => {
      const d = query.state.data;
      const active = d && (d.backups.some((b) => b.status === 'running') || d.restores.some((r) => r.status === 'running'));
      return active ? 1500 : 20_000;
    },
    // A busy database is a pause, not a failure: try again without showing anything.
    retry: (count, e) => (e instanceof BackupCallError && e.busy ? true : count < 2),
    retryDelay: 1500,
    staleTime: 0,
  });
}

/** Refresh the list now (after pressing a button). */
export function useRefreshBackups() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: BACKUPS_KEY });
}

// ----------------------------------------------------------------- the words --

/** Plain names for the tables an admin actually recognises. */
export const FRIENDLY_TABLES: Record<string, string> = {
  'public.profiles': 'People (every account)',
  'public.applications': 'Applications to join',
  'public.brands': 'Brands',
  'public.offers': 'Offers',
  'public.offer_applications': 'Offer requests',
  'public.content_submissions': 'Videos submitted',
  'public.contests': 'Contests',
  'public.contest_entries': 'Contest entries',
  'wurxbase.creators': 'Paid Collabs creators',
  'public.audit_log': 'Activity log entries',
};

export function formatBytes(n: number | null | undefined): string {
  const b = Number(n ?? 0);
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / 1048576).toFixed(b < 10 * 1048576 ? 1 : 0)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now.getTime() - 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today, ${time}`;
  if (d.toDateString() === y.toDateString()) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}, ${time}`;
}

export function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export const KIND_LABEL: Record<BackupKind, string> = {
  manual: 'Backup',
  before_restore: 'Saved before a restore',
  uploaded: 'From a file',
};
