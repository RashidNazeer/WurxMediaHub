import { useMutation } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';

/**
 * Upload a brand logo or a product image.
 *
 * Straight to Supabase Storage rather than through an Edge Function: the
 * bucket has its own policies, and only active staff may write to it, so
 * routing megabytes of image through a function would add a hop and buy
 * nothing. Reads are public, because these are pictures that already sit on a
 * public TikTok Shop listing.
 *
 * The checks below are repeated by the bucket itself (`allowed_mime_types` and
 * `file_size_limit`). This copy exists so somebody picking a 9 MB photo is told
 * immediately instead of after the upload fails.
 */

const BUCKET = 'brand-assets';

/** SVG is absent on purpose: it can carry script, and a logo does not need it. */
export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
const MAX_BYTES = 2 * 1024 * 1024;

const EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Null when the file is fine, otherwise something a person can act on. */
function checkImage(file: File): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) {
    return 'Use a PNG, JPG or WebP image';
  }
  if (file.size > MAX_BYTES) {
    return `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 2 MB.`;
  }
  return null;
}

export function useImageUpload() {
  return useMutation({
    mutationFn: async ({ file, folder }: { file: File; folder: string }): Promise<string> => {
      const problem = checkImage(file);
      if (problem) throw new Error(problem);

      // A random name, never the one they picked. Two admins uploading
      // "logo.png" for different brands must not collide, and a filename
      // typed by a person is not something to build a public URL out of.
      const name = `${crypto.randomUUID()}.${EXTENSION[file.type] ?? 'png'}`;
      const path = `${folder}/${name}`;

      const storage = getSupabase().storage.from(BUCKET);
      const { error } = await storage.upload(path, file, {
        contentType: file.type,
        // These are immutable: a new image gets a new name rather than
        // replacing one, so it can be cached hard.
        cacheControl: '31536000',
        upsert: false,
      });

      if (error) {
        throw new Error(
          error.message.toLowerCase().includes('exceeded')
            ? 'That image is larger than the 2 MB limit'
            : 'That upload did not go through. Try again.'
        );
      }

      return storage.getPublicUrl(path).data.publicUrl;
    },
  });
}
