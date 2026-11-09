import { getSupabase } from '@/lib/supabase';

/**
 * A CREATOR'S CATEGORY AS EUKA HAS IT, for the Add Creator form in the vendored app.
 *
 * Rashid, 2026-11-06: Category should fill itself from Euka, including for a creator being added.
 * `collab-gmv-sync` (categories mode) looks handles up in Euka and stores them in
 * `euka_creator_categories`; this reads what it has stored for the handles typed in the form, so
 * the field can be prefilled at once for anybody Euka was already asked about. A handle never
 * looked up gets its category within one run of the cycle (10 minutes) once the row is saved.
 * Same label as the sync writes: the first two of Euka's categories, joined with " / ".
 */
export async function storedCategoryFor(handles: string[]): Promise<string> {
  const keys = handles
    .map((h) => String(h ?? '').trim().toLowerCase().replace(/^@+/, ''))
    .filter(Boolean);
  if (!keys.length) return '';
  const { data, error } = await getSupabase()
    .from('euka_creator_categories')
    .select('handle, categories')
    .in('handle', keys)
    .eq('found', true);
  if (error || !data) return '';
  for (const k of keys) {
    const row = data.find((r) => r.handle === k);
    const label = [...new Set((row?.categories ?? []).map((c: string) => String(c).trim()).filter(Boolean))]
      .slice(0, 2)
      .join(' / ');
    if (label) return label;
  }
  return '';
}
