/**
 * A brand's product pictures, for the product bands in the angle drawer.
 *
 * Umar, 2026-10-07: the band should look like the Brands screen's product
 * group -- which carries the product's picture beside its name.
 *
 * SAME SOURCE AS THAT SCREEN. `collab-products` decides between Euka and
 * Reacher and answers with `{ name, image }` per product; the Brands screen
 * builds exactly this map from exactly this function. Two screens showing a
 * different picture for one product would be worse than neither showing one.
 *
 * ONE FETCH PER BRAND, SHARED. Every band in every angle wants a picture and
 * this is an Edge Function round trip, so the promise is cached per brand and
 * every caller waits on the same one. An angle screen with four angles and
 * three products each would otherwise make twelve identical calls.
 *
 * A FAILURE IS NOT CACHED. It is dropped so the next mount asks again: "we
 * could not reach the catalogue once" must never harden into "this brand has
 * no pictures" for the rest of the session. The bands render without pictures
 * meanwhile, which is why nothing here throws at the caller.
 */

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

/** Lowercased product name -> image URL. */
type ProductPics = Map<string, string>;

const CACHE = new Map<string, Promise<ProductPics>>();

async function fetchPics(brand: string): Promise<ProductPics> {
  const { data, error } = await getSupabase().functions.invoke('collab-products', {
    body: { brand },
  });
  if (error) throw new Error(error.message || 'catalogue unavailable');
  const rows = (data as { products?: Array<{ name?: string; image?: string }> } | null)?.products;
  const map: ProductPics = new Map();
  for (const pr of Array.isArray(rows) ? rows : []) {
    const key = String(pr?.name ?? '').trim().toLowerCase();
    const img = String(pr?.image ?? '').trim();
    if (key && img) map.set(key, img);
  }
  return map;
}

function productPics(brand: string): Promise<ProductPics> {
  const key = String(brand || '').trim();
  if (!key) return Promise.resolve(new Map());
  if (!CACHE.has(key)) {
    const job = fetchPics(key);
    job.catch(() => CACHE.delete(key));
    CACHE.set(key, job);
  }
  return (CACHE.get(key) as Promise<ProductPics>).catch(() => new Map<string, string>());
}

/**
 * The brand's pictures, or null until they arrive.
 *
 * `alive` is set in the effect BODY rather than only in the cleanup, because
 * StrictMode mounts, unmounts and remounts: a flag left false by the first
 * cleanup would make the second mount discard its own result and the bands
 * would never get a picture. That exact bug cost a day on the Categorise
 * button; it is not repeating here.
 */
export function useProductPics(brand: string | null | undefined): ProductPics | null {
  const [pics, setPics] = useState<ProductPics | null>(null);
  useEffect(() => {
    let alive = true;
    setPics(null);
    const name = String(brand || '').trim();
    if (!name) return undefined;
    productPics(name).then((m) => {
      if (alive) setPics(m);
    });
    return () => {
      alive = false;
    };
  }, [brand]);
  return pics;
}
