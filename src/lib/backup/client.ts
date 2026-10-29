import { BackupWriter, openBackup } from './format';
import {
  chunksFromFile,
  picturesFromFile,
  writeLines,
  type Chunk,
  type PictureData,
} from './lines';
import { packPictures, type PictureRef } from './pictures';

/**
 * What the admin's browser does around the `backup-data` Edge Function.
 *
 * The function only gatekeeps and moves small pages. Everything that costs CPU
 * happens HERE, on the admin's own computer: compressing, encrypting,
 * decrypting, hashing pictures. The passphrase is typed into the page and used
 * here; it is never sent anywhere.
 *
 * `call` is the one door to the function. It resolves with the JSON answer and
 * THROWS an Error carrying the function's plain-words message when it refuses.
 * The screen passes in a real one; the tests pass in a fetch to a local stack.
 */

export type Call = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

export interface Progress {
  phase: string;
  done?: number;
  total?: number;
}
type OnProgress = (p: Progress) => void;

const UPLOAD_BATCH_BYTES = 1_200_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Repeat a request that is safe to repeat. The platform retires Edge Function workers
 * from time to time (even mid-answer), so a page of a backup can fail for no reason
 * of its own. A refusal (a 4xx, "That password is not right.") is NEVER repeated:
 * only a cut connection, a 5xx or a "database busy" answer is. Used for reading
 * pages and for sending pieces (the database ignores a piece it already has).
 */
async function repeatable(call: Call, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call(body);
    } catch (e) {
      const err = e as { status?: number; busy?: boolean };
      const status = err.status ?? 0;
      const transient = status === 0 || status >= 500 || err.busy === true;
      if (!transient || attempt >= 6) throw e;
      await sleep(500 * (attempt + 1));
    }
  }
}

// ------------------------------------------------------------------ download --

export interface DownloadOptions {
  backupId: string;
  /** The admin's password, checked again by the server. */
  password: string;
  /** Optional: protects the file. Never leaves this computer. */
  passphrase?: string | null;
  /** Pack the uploaded pictures (logos, avatars) into the file too. */
  withPictures: boolean;
  onProgress?: OnProgress;
  /** How to fetch a picture. The browser's own fetch unless a test swaps it. */
  fetcher?: (url: string, signal: AbortSignal) => Promise<Response>;
}

export interface DownloadResult {
  bytes: Uint8Array;
  filename: string;
  pictures: { count: number; skipped: number };
}

export async function downloadBackupFile(call: Call, o: DownloadOptions): Promise<DownloadResult> {
  const progress = o.onProgress ?? (() => {});
  progress({ phase: 'Checking your password' });
  const started = await call({ action: 'backup.download_start', backupId: o.backupId, password: o.password });
  const ticket = String(started.ticket);
  const createdAt = String(started.createdAt ?? new Date().toISOString());

  // 1. every piece of the database, a page at a time
  const chunks: Chunk[] = [];
  let after = 0;
  for (;;) {
    progress({ phase: 'Collecting your data', done: chunks.length });
    const page = (await repeatable(call, { action: 'backup.chunks', backupId: o.backupId, ticket, afterSeq: after })) as {
      chunks: Chunk[];
      done: boolean;
      lastSeq: number;
    };
    chunks.push(...page.chunks);
    after = page.lastSeq;
    if (page.done || page.chunks.length === 0) break;
  }

  // 2. the pictures
  let pictures: { items: PictureData[]; skipped: number } | null = null;
  if (o.withPictures) {
    progress({ phase: 'Finding the pictures' });
    const listed = (await repeatable(call, { action: 'pictures.list', backupId: o.backupId, ticket })) as { pictures: PictureRef[] };
    const packed = await packPictures(
      listed.pictures,
      (done, total) => progress({ phase: 'Saving the pictures', done, total }),
      o.fetcher,
    );
    pictures = { items: packed.items, skipped: packed.skipped };
  }

  // 3. compress (and protect) it into one file
  progress({ phase: o.passphrase ? 'Compressing and locking the file' : 'Compressing the file' });
  const writer = await BackupWriter.create({ passphrase: o.passphrase ?? null });
  await writeLines({ chunks, pictures, write: (l) => writer.writeLine(l) });
  const bytes = await writer.finish();

  const stamp = createdAt.slice(0, 16).replace(/[-:T]/g, '');
  return {
    bytes,
    filename: `prism-backup-${stamp}.prismbackup`,
    pictures: { count: pictures?.items.length ?? 0, skipped: pictures?.skipped ?? 0 },
  };
}

// -------------------------------------------------------------------- upload --

/**
 * Read a backup file and send it to the server as a new "uploaded" backup.
 * Throws BackupError (from format.ts) for a wrong passphrase or a damaged file,
 * and the server's own message if it refuses a piece or the whole.
 */
export async function uploadBackupFile(
  call: Call,
  bytes: Uint8Array,
  passphrase: string | null,
  onProgress?: OnProgress,
): Promise<{ backupId: string; totalRows: number }> {
  const progress = onProgress ?? (() => {});
  const opened = await openBackup(bytes, passphrase);
  progress({ phase: 'Starting' });
  const { backupId } = (await call({ action: 'backup.upload_start' })) as { backupId: string };

  let batch: Chunk[] = [];
  let size = 0;
  let sent = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    await repeatable(call, { action: 'backup.upload_chunks', backupId, chunks: batch });
    sent += batch.length;
    progress({ phase: 'Sending your backup', done: sent });
    batch = [];
    size = 0;
  };
  try {
    for await (const c of chunksFromFile(opened)) {
      if (size + c.payload.length > UPLOAD_BATCH_BYTES && batch.length > 0) await flush();
      batch.push(c);
      size += c.payload.length;
    }
    await flush();
    progress({ phase: 'Checking the backup' });
    const done = (await call({ action: 'backup.upload_finish', backupId })) as { totalRows: number };
    return { backupId, totalRows: Number(done.totalRows) };
  } catch (e) {
    // Do not leave a half-sent backup behind.
    await call({ action: 'backup.delete', backupId }).catch(() => {});
    throw e;
  }
}

// ------------------------------------------------------------------ pictures --

export type PutSigned = (bucket: string, path: string, token: string, bytes: Uint8Array, type: string) => Promise<boolean>;

export interface PicturesRestored {
  restored: number;
  failed: string[];
  skipped: string[];
}

/** After the data is back: put the pictures from the file back in Storage. */
export async function restorePicturesFromFile(
  call: Call,
  put: PutSigned,
  bytes: Uint8Array,
  passphrase: string | null,
  onProgress?: OnProgress,
): Promise<PicturesRestored> {
  const progress = onProgress ?? (() => {});
  const out: PicturesRestored = { restored: 0, failed: [], skipped: [] };
  const opened = await openBackup(bytes, passphrase);
  const pics: PictureData[] = [];
  for await (const p of picturesFromFile(opened)) {
    if ('picture' in p) pics.push(p.picture);
    else out.failed.push(p.damaged);
  }
  for (let i = 0; i < pics.length; i += 50) {
    const slice = pics.slice(i, i + 50);
    const res = (await repeatable(call, {
      action: 'pictures.upload_urls',
      items: slice.map((p) => ({ bucket: p.bucket, path: p.path })),
    })) as { urls: { bucket: string; path: string; token: string }[]; skipped: string[] };
    out.skipped.push(...res.skipped);
    for (const u of res.urls) {
      const pic = slice.find((p) => p.bucket === u.bucket && p.path === u.path);
      if (!pic) continue;
      progress({ phase: 'Putting the pictures back', done: out.restored, total: pics.length });
      if (await put(u.bucket, u.path, u.token, pic.bytes, pic.type)) out.restored++;
      else out.failed.push(`${u.bucket}/${u.path}`);
    }
  }
  return out;
}
