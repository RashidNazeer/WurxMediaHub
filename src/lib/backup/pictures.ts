import type { PictureData } from './lines';

/**
 * Uploaded pictures (brand logos, creator avatars, anything in Storage).
 *
 * They are not in the database, so they are not in a stored backup. They ride
 * along inside a DOWNLOADED backup file, packed in by the admin's browser, and
 * come back when that file is restored. Restoring a picture uploads it over the
 * same path and never deletes anything: a picture added after the backup stays.
 *
 * TWO HONEST LIMITS, both shown on screen rather than hidden:
 *   - a size budget. Past it, remaining pictures are SKIPPED and counted, and
 *     the footer says how many, so a backup never claims to hold pictures it
 *     does not. The data itself is never affected by the budget.
 *   - a picture bigger than PICTURE_MAX_BYTES is skipped on its own.
 */

const PICTURE_BUDGET_BYTES = 120 * 1024 * 1024;
const PICTURE_MAX_BYTES = 10 * 1024 * 1024;
/** Per picture. A slow one is skipped and counted, never waited on forever. */
const PICTURE_TIMEOUT_MS = 20_000;

/** One picture the server knows about, with a short-lived link to read it. */
export interface PictureRef {
  bucket: string;
  path: string;
  size: number;
  type: string;
  url: string;
}

interface PackedPictures {
  items: PictureData[];
  skipped: number;
  bytes: number;
}

export async function packPictures(
  refs: PictureRef[],
  onProgress?: (done: number, total: number) => void,
  fetcher: (url: string, signal: AbortSignal) => Promise<Response> = (u, signal) => fetch(u, { signal }),
): Promise<PackedPictures> {
  const out: PackedPictures = { items: [], skipped: 0, bytes: 0 };
  let i = 0;
  for (const ref of refs) {
    onProgress?.(i++, refs.length);
    if (ref.size > PICTURE_MAX_BYTES || out.bytes + ref.size > PICTURE_BUDGET_BYTES) {
      out.skipped++;
      continue;
    }
    // One picture that never answers must not hang the whole download.
    const timer = new AbortController();
    const giveUp = setTimeout(() => timer.abort(), PICTURE_TIMEOUT_MS);
    try {
      const res = await fetcher(ref.url, timer.signal);
      if (!res.ok) {
        out.skipped++;
        continue;
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > PICTURE_MAX_BYTES || out.bytes + bytes.length > PICTURE_BUDGET_BYTES) {
        out.skipped++;
        continue;
      }
      out.items.push({ bucket: ref.bucket, path: ref.path, type: ref.type, bytes });
      out.bytes += bytes.length;
    } catch {
      out.skipped++;
    } finally {
      clearTimeout(giveUp);
    }
  }
  onProgress?.(refs.length, refs.length);
  return out;
}
