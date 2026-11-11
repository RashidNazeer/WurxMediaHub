/**
 * WHICH BRANDS THE REACHER SYNC READS, AND HOW.
 *
 * Until 2026-11-11 this sync was Irwin Naturals and nothing else, by Rashid's instruction
 * ("please do not disturb anything, just for Irwin Naturals"). Biostime, which is a Reacher
 * shop and not an Euka brand, therefore never had a video filed: its newest video in the app
 * was 29 October. The rule is now: every Paid Collabs brand that Reacher holds and Euka does
 * NOT, read from Reacher. Euka wins a brand both hold, as everywhere else.
 *
 * TWO WAYS TO READ A SHOP:
 *   'shop'     list every video the shop holds in the window, in one go. Irwin's way, unchanged:
 *              a small shop (about 200 videos in 120 days).
 *   'handles'  ask for one creator at a time, for the creators on OUR roster. Every other brand:
 *              a big shop has thousands of affiliate videos and a whole-shop list is cut off
 *              before it reaches ours. A rotating batch per run, so every creator is read once
 *              every few cycles and a run stays inside its time budget.
 *
 * Pure on purpose (no Deno, no network), so `pnpm verify:reacher-targets` can run it.
 */
import { matchBrand } from '../_shared/collab-gmv.ts';

export const IRWIN_BRAND = 'Irwin Naturals';

export type Mode = 'shop' | 'handles';
export type Target = { brand: string; shop: { name: string; id: number }; mode: Mode };

export function pickTargets(
  ourBrands: string[],
  eukaBrands: { name: string }[],
  reacherShops: { name: string; id: number }[],
  wanted: Set<string> | null,
): { targets: Target[]; euka: string[]; neither: string[] } {
  const targets: Target[] = [];
  const euka: string[] = [];
  const neither: string[] = [];
  const names = [...new Set(ourBrands.map((b) => b.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  for (const brand of names) {
    if (wanted && !wanted.has(brand)) continue;
    if (matchBrand(brand, eukaBrands)) { euka.push(brand); continue; }
    const shop = matchBrand(brand, reacherShops);
    if (!shop) { neither.push(brand); continue; }
    targets.push({ brand, shop, mode: brand.toLowerCase() === IRWIN_BRAND.toLowerCase() ? 'shop' : 'handles' });
  }
  return { targets, euka, neither };
}

/**
 * This run's slice of a brand's creator handles. The cycle number moves the window along by `take`
 * each time, wrapping, so successive runs cover everybody. All of them when they fit in one run.
 */
export function rotate(handles: string[], take: number, cycle: number): string[] {
  const all = [...new Set(handles.filter(Boolean))].sort();
  if (take <= 0 || all.length <= take) return all;
  const start = ((cycle * take) % all.length + all.length) % all.length;
  return Array.from({ length: take }, (_, i) => all[(start + i) % all.length]!);
}
