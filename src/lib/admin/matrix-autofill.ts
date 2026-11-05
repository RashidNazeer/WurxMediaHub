/**
 * AUTOFILLING THE PERFORMANCE MATRIX: each creator's GMV and ad spend for each month.
 *
 * Rashid, 2026-11-06: the brand Performance sheet has one GMV and one Ad cell per creator per
 * month (stored in `creators.monthly`, `{ "2026-10": { gmv, adSpent }, "2026-10@handle": ... }`).
 * They were typed by hand. We now hold both figures, so every month fills itself:
 *   GMV    what Euka or Reacher report the creator made for the brand that month, by sales date
 *          (`collab_creator_month_gmv`)
 *   Ad     what the ads for her videos cost that month (`euka_ad_video_month`, per video)
 *
 * THE RULE THAT KEEPS THE TEAM'S WORK SAFE: a cell somebody TYPED IS NEVER TOUCHED. Every field
 * this fills is listed in the cell's `auto` array; a field that is not listed there was typed, and
 * stays. A listed field is refreshed when the figure moves (late sales settle for about a week
 * after a month ends). The moment somebody edits a filled field it leaves `auto`, and from then on
 * it is theirs. Nothing is ever removed: no figure means unknown, not zero.
 *
 * Pure: no database, no React. `pnpm verify:month-gmv` runs it as it is.
 */

export type Field = 'gmv' | 'adSpent';
export type Cell = { gmv?: number; adSpent?: number; auto?: Field[] };
export type Monthly = Record<string, unknown>;

export interface Entry {
  /** The key in `monthly`: `2026-10`, or `2026-10@handle` for a second account. */
  key: string;
  gmv?: number | null;
  adSpent?: number | null;
}

/** Cents, because a cell holds money and a float comparison would refill it on every visit. */
const cents = (n: unknown): number => Math.round((Number(n) || 0) * 100) / 100;

const isCell = (v: unknown): v is Cell => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Apply fills to a creator's `monthly`. Returns the new object, or null when nothing changes (so
 * the caller writes nothing and a screen that opens twice does not write twice).
 */
export function applyFills(monthly: Monthly | null | undefined, entries: Entry[]): Monthly | null {
  const cur: Monthly = monthly ?? {};
  const next: Monthly = { ...cur };
  let changed = false;

  for (const e of entries) {
    const before = isCell(cur[e.key]) ? (cur[e.key] as Cell) : {};
    const cell: Cell = { ...before };
    const auto = new Set<Field>(before.auto ?? []);
    let touched = false;

    for (const f of ['gmv', 'adSpent'] as Field[]) {
      const want = e[f] == null ? 0 : cents(e[f]);
      const has = before[f] != null && Number(before[f]) !== 0;
      if (has && !auto.has(f)) continue; // typed by a person: never touched
      if (want > 0) {
        if (!has || cents(before[f]) !== want || !auto.has(f)) {
          cell[f] = want;
          auto.add(f);
          touched = true;
        }
      }
      // no figure now: leave what is there. A month the platform was never read for, or a creator
      // Euka's top 50 did not reach, is "unknown", not "zero", so nothing is removed on its account.
    }
    if (!touched) continue;

    if (auto.size) cell.auto = [...auto]; else delete cell.auto;
    if (cell.gmv == null && cell.adSpent == null) delete next[e.key]; else next[e.key] = cell;
    changed = true;
  }
  return changed ? next : null;
}

/** The video id in a TikTok link: `/video/<digits>`. */
export function videoIdOf(url: unknown): string {
  return /\/video\/(\d+)/.exec(String(url ?? ''))?.[1] ?? '';
}

/** The handle in a TikTok video link: `/@name/video/…`, lower-case. Empty for a short link. */
export function videoHandleOf(url: unknown): string {
  return (/tiktok\.com\/@([^/?#]+)\/video\//i.exec(String(url ?? ''))?.[1] ?? '').trim().toLowerCase();
}

/** A `YYYY-MM` month from an ISO date (`2026-10-01`). */
export const monthKeyOf = (iso: unknown): string => String(iso ?? '').slice(0, 7);
