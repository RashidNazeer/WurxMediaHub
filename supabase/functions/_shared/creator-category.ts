/**
 * A CREATOR'S CATEGORY, FROM EUKA.
 *
 * Rashid, 2026-11-06: the Category column on Paid Collabs → Creators should fill itself from
 * Euka for every creator, and for each creator added later. Euka's market intelligence lists the
 * top three TikTok Shop categories a creator sells in (`category_list`, asked for with
 * `need_category: 1`) on the same `creator/rank` search the follower lookup uses.
 *
 * THE RULES THAT KEEP IT HONEST
 *   - Only an exact handle match is believed (it is a keyword search: "maddie" can answer with
 *     another Maddie), the same rule as `euka-followers.ts`.
 *   - Nothing a person typed is ever overwritten. A category is written only into a row whose
 *     Category is blank, or whose Category is still exactly what this sync wrote last time
 *     (so a later refresh from Euka can update it, and a team edit freezes it).
 *   - Every row that carries the handle gets it, as the app's own `syncCategory` does when a
 *     category is typed.
 */
import { EUKA_V1, type EukaAuth } from './euka-accounts.ts';
import { normHandle } from './euka-followers.ts';

/** How many of Euka's labels go into the cell. The column is narrow; the hover shows all of it. */
export const LABELS_SHOWN = 2;
/** A found answer is looked up again after this long, so a creator who changes niche follows. */
export const RECHECK_DAYS = 30;

/** Euka's labels as one cell: "Beauty & Personal Care / Health". Empty when there are none. */
export function labelFrom(categories: unknown): string {
  if (!Array.isArray(categories)) return '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of categories) {
    const t = String(c ?? '').trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === LABELS_SHOWN) break;
  }
  return out.join(' / ');
}

const rowsOf = (payload: unknown): Record<string, any>[] => {
  if (Array.isArray(payload)) return payload as Record<string, any>[];
  for (const key of ['data', 'rows', 'list', 'records']) {
    const v = (payload as Record<string, any> | null)?.[key];
    if (Array.isArray(v)) return v as Record<string, any>[];
  }
  return [];
};

/**
 * The categories in a rank answer for exactly this handle. `null` is "no row was this person";
 * `[]` is "it was her, and Euka lists no category".
 */
export function categoriesFromRank(payload: unknown, rawHandle: string): string[] | null {
  const handle = normHandle(rawHandle);
  if (!handle) return null;
  for (const row of rowsOf(payload)) {
    const theirs = normHandle(row.creator_handle ?? row.handle ?? row.unique_id ?? row.username);
    if (!theirs || theirs !== handle) continue;
    const list = row.category_list ?? row.categories ?? [];
    return Array.isArray(list) ? list.map((c: unknown) => String(c ?? '').trim()).filter(Boolean).slice(0, 3) : [];
  }
  return null;
}

/** Ask Euka about one handle. Throws on a non-200 so the caller can record the failure. */
export async function categoriesForHandle(auth: EukaAuth, rawHandle: string): Promise<string[] | null> {
  const handle = normHandle(rawHandle);
  if (!handle) return null;
  const r = await fetch(`${EUKA_V1}/market-intelligence/tiktok/creator/rank`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyword: handle,
      region: 'US',
      language: 'en-US',
      currency: 'USD',
      date_range: 'last30Day',
      sort_field: { field: 'revenue', type: 'DESC' },
      page_size: 10,
      page_number: 1,
      need_category: 1,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`creator/rank ${r.status}`);
  return categoriesFromRank(await r.json().catch(() => null), handle);
}

export type RosterRow = {
  id: number;
  category: string | null;
  tiktok_account: string | null;
  tiktok_account_2: string | null;
};
export type StoredCategory = {
  /** the label this sync wants in the cell; '' when Euka listed none */
  label: string;
  /** the label this sync last wrote, to tell its own text from a typed one */
  written: string | null;
  found: boolean;
  checkedAt: number;
};

const blank = (v: unknown) => !String(v ?? '').trim();
const handlesOf = (r: RosterRow) => [normHandle(r.tiktok_account), normHandle(r.tiktok_account_2)].filter(Boolean);

/** Whether Euka may put a category in this row: it is empty, or it is still this sync's own text. */
export function mayFill(r: RosterRow, written: string | null): boolean {
  if (blank(r.category)) return true;
  return written !== null && String(r.category).trim() === written;
}

/**
 * The rows to change and what to put there. A row takes the label of the first of its handles
 * that has one stored; a row whose Category a person typed is never in the plan.
 */
export function planWrites(roster: RosterRow[], stored: Map<string, StoredCategory>): { id: number; category: string; handle: string }[] {
  const out: { id: number; category: string; handle: string }[] = [];
  for (const r of roster) {
    for (const h of handlesOf(r)) {
      const s = stored.get(h);
      if (!s || !s.found || !s.label) continue;
      if (mayFill(r, s.written) && String(r.category ?? '').trim() !== s.label) out.push({ id: r.id, category: s.label, handle: h });
      break;
    }
  }
  return out;
}

/**
 * Handles to ask Euka about next: those on a row Euka may fill, never asked first, then the
 * oldest answers once they are older than RECHECK_DAYS. A failure is stored back-dated so it comes
 * round again after about a day, not at the front of every run.
 */
export function dueHandles(roster: RosterRow[], stored: Map<string, StoredCategory>, now: number, batch: number): string[] {
  const want = new Set<string>();
  for (const r of roster) {
    for (const h of handlesOf(r)) {
      const s = stored.get(h);
      if (mayFill(r, s?.written ?? null)) want.add(h);
    }
  }
  const stale = now - RECHECK_DAYS * 86_400_000;
  return [...want]
    .filter((h) => !stored.has(h) || stored.get(h)!.checkedAt < stale)
    .sort((a, b) => (stored.get(a)?.checkedAt ?? 0) - (stored.get(b)?.checkedAt ?? 0))
    .slice(0, batch);
}
