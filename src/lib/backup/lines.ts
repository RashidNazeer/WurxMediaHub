import { sha256Hex, toBase64, fromBase64, type OpenedBackup } from './format';

/**
 * How the pieces of a backup in the database (chunks) become the lines of a
 * backup file, and back. Shared by the admin screen, the command-line tools and
 * the tests, so there is exactly one definition of the file.
 *
 * The file is a list of lines:
 *
 *   {"k":"head", ...}                                    first: tables and columns
 *   {"k":"rows","t":"public.x","n":500,"h":"<sha256>"} TAB [ {...}, {...} ]
 *   {"k":"file","bucket":..,"path":..,...}              TAB <base64>   (pictures)
 *   {"k":"end", ...}                                     last: what it should add up to
 *
 * ROWS TRAVEL AS TEXT, NEVER AS JAVASCRIPT NUMBERS. A chunk's payload is the
 * database's own text for those rows, and it is passed along untouched. TikTok
 * ids are 19-digit bigints; JSON.parse would silently round them. The only
 * place a payload is parsed here is the footer, which holds counts, not rows.
 */

export type ChunkKind = 'head' | 'rows' | 'end';

/** One piece of a backup, exactly as it sits in `backup.chunks`. */
export interface Chunk {
  seq: number;
  kind: ChunkKind;
  table_id: string | null;
  n: number;
  hash: string;
  payload: string;
}

export interface PictureData {
  bucket: string;
  path: string;
  type: string;
  bytes: Uint8Array;
}

function chunkToLine(c: Chunk): string {
  if (c.kind !== 'rows') return c.payload;
  return JSON.stringify({ k: 'rows', t: c.table_id, n: c.n, h: c.hash }) + '\t' + c.payload;
}

async function pictureLine(p: PictureData): Promise<string> {
  const meta = {
    k: 'file',
    bucket: p.bucket,
    path: p.path,
    type: p.type,
    size: p.bytes.length,
    h: await sha256Hex(p.bytes),
  };
  return JSON.stringify(meta) + '\t' + toBase64(p.bytes);
}

/** The footer, updated to vouch for the pictures that were packed in. */
function endWithPictures(
  endPayload: string,
  pictures: { count: number; bytes: number; skipped: number },
): string {
  const end = JSON.parse(endPayload) as Record<string, unknown>;
  end.files = pictures.count;
  end.file_bytes = pictures.bytes;
  end.files_skipped = pictures.skipped;
  return JSON.stringify(end);
}

interface FileBuild {
  /** Everything from the database, in order: head, rows..., end. */
  chunks: AsyncIterable<Chunk> | Iterable<Chunk>;
  pictures?: { items: PictureData[]; skipped: number } | null;
  /** Writes one line into the file. */
  write: (line: string) => Promise<void>;
}

/** Write every line of a backup file. The pictures go in just before the footer. */
export async function writeLines(build: FileBuild): Promise<void> {
  for await (const c of build.chunks) {
    if (c.kind === 'end') {
      const pics = build.pictures?.items ?? [];
      let bytes = 0;
      for (const p of pics) {
        await build.write(await pictureLine(p));
        bytes += p.bytes.length;
      }
      await build.write(
        endWithPictures(c.payload, { count: pics.length, bytes, skipped: build.pictures?.skipped ?? 0 }),
      );
    } else {
      await build.write(chunkToLine(c));
    }
  }
}

/**
 * Read a backup file back into chunks, ready to send to the database. The
 * database re-checks every fingerprint when a piece arrives, so a damaged file
 * is refused at the door; nothing here has to be trusted.
 */
export async function* chunksFromFile(opened: OpenedBackup): AsyncGenerator<Chunk> {
  let seq = 0;
  for await (const line of opened.lines()) {
    if (line.startsWith('{"k":"file"')) continue; // pictures are read separately
    const tab = line.indexOf('\t');
    if (tab < 0) {
      const meta = JSON.parse(line) as { k?: string };
      if (meta.k !== 'head' && meta.k !== 'end') continue;
      yield {
        seq: ++seq,
        kind: meta.k,
        table_id: null,
        n: 0,
        hash: await sha256Hex(line),
        payload: line,
      };
    } else {
      const meta = JSON.parse(line.slice(0, tab)) as { k?: string; t?: string; n?: number; h?: string };
      if (meta.k !== 'rows') continue;
      yield {
        seq: ++seq,
        kind: 'rows',
        table_id: String(meta.t),
        n: Number(meta.n),
        hash: String(meta.h),
        payload: line.slice(tab + 1),
      };
    }
  }
}

/** The pictures in a backup file. A picture that fails its fingerprint is reported, not trusted. */
export async function* picturesFromFile(
  opened: OpenedBackup,
): AsyncGenerator<{ picture: PictureData } | { damaged: string }> {
  for await (const line of opened.lines()) {
    if (!line.startsWith('{"k":"file"')) continue;
    const tab = line.indexOf('\t');
    const meta = JSON.parse(line.slice(0, tab)) as {
      bucket: string;
      path: string;
      type: string;
      h: string;
    };
    const bytes = fromBase64(line.slice(tab + 1));
    if ((await sha256Hex(bytes)) !== meta.h) {
      yield { damaged: `${meta.bucket}/${meta.path}` };
      continue;
    }
    yield { picture: { bucket: meta.bucket, path: meta.path, type: meta.type, bytes } };
  }
}
