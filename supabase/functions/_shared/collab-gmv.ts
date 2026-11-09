/**
 * THE PURE PARTS of collab-gmv-sync: months, which platform owns a brand, what is
 * stale, and how each platform's answer becomes rows. No network and no Deno API
 * in here, so `scripts/verify/collabs/check-creator-month-gmv.mjs` runs it as it is.
 *
 * Rashid, 2026-11-06: the GMV a creator made for a brand between the first and the
 * last day of a month, by SALES date, whichever video the sale came from. Euka and
 * Reacher both keep daily sales and answer for any date range; our own video data
 * cannot, because a video's revenue is one overwritten running total.
 */

export type Platform = 'euka' | 'reacher';

export const EUKA_CAP = 50; // the most creators one Euka top-creators call returns

/** `YYYY-MM` for a date, in UTC. */
export const monthOf = (d: Date): string => d.toISOString().slice(0, 7);

/** The last `n` months ending with the one `now` is in, newest first. */
export function recentMonths(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(monthOf(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))));
  return out;
}

/** First and last day of a month, the last one capped at `today` (nothing has happened later). */
export function monthWindow(month: string, today: Date): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0));
  const t = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  const end = last.getTime() > t.getTime() ? t : last;
  return { start: `${month}-01`, end: end.toISOString().slice(0, 10) };
}

/**
 * When a month stops moving: a week after it ends. TikTok attributes some sales late,
 * so a month is re-read until one read has been taken after this.
 */
export function settledAt(month: string): Date {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) + 8 * 86_400_000);
}

const HOUR = 3_600_000;

/**
 * Does a month need reading? Never read: yes. Read before it settled: yes once it is
 * old enough to be worth it (6 hours for the current month, 12 for last month while it
 * settles). Read after it settled: never again.
 */
export function needsRead(month: string, fetchedAt: Date | null, now: Date): boolean {
  if (!fetchedAt) return true;
  if (fetchedAt.getTime() >= settledAt(month).getTime()) return false;
  const age = now.getTime() - fetchedAt.getTime();
  return age > (month === monthOf(now) ? 6 * HOUR : 12 * HOUR);
}

/* ───────────────────────────── which platform owns a brand ───────────────────────────── */

const norm = (s: unknown): string => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Our name for a brand when it differs from the platform's. Normalised on both sides. */
const ALIASES: Record<string, string> = {
  apothecary: 'apothecarybrands',
  swisse: 'swissewellness',
};

/**
 * The candidate whose name is our brand's: the same once normalised, or an alias, or
 * (so "Apothecary" finds "Apothecary Brands" without an alias) the candidate starting
 * with our name when exactly one does. Ambiguity returns null, never a guess.
 */
export function matchBrand<T extends { name: string }>(ours: string, candidates: T[]): T | null {
  const want = norm(ours);
  if (!want) return null;
  const target = ALIASES[want] ?? want;
  const exact = candidates.filter((c) => norm(c.name) === target);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const starts = candidates.filter((c) => norm(c.name).startsWith(want));
  return starts.length === 1 ? starts[0]! : null;
}

/* ─────────────────────────────── what a platform says → rows ─────────────────────────────── */

export interface CreatorGmv {
  handle: string;
  gmv: number;
}

/** A handle the way both platforms and the Paid Collabs rows hold it: lower-case, no @. */
export const cleanHandle = (h: unknown): string => String(h ?? '').trim().replace(/^@+/, '').toLowerCase();

const money = (n: unknown): number => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0;
};

/** Merge duplicates of one handle by adding them (a platform listing a creator twice is two slices of her sales). */
function merge(rows: CreatorGmv[]): CreatorGmv[] {
  const by = new Map<string, number>();
  for (const r of rows) {
    if (!r.handle) continue;
    by.set(r.handle, Math.round(((by.get(r.handle) ?? 0) + r.gmv) * 100) / 100);
  }
  return [...by.entries()].map(([handle, gmv]) => ({ handle, gmv }));
}

/**
 * Euka's top-creators answer: `{ affiliates: [{ handle, totalGmv }] }`, at most 50. When it
 * returned the cap, the list was cut and `floor` is the smallest figure it reached: a creator
 * who is not in it made no more than that.
 */
export function fromEuka(body: unknown): { rows: CreatorGmv[]; truncated: boolean; floor: number | null } {
  const list = Array.isArray((body as { affiliates?: unknown })?.affiliates)
    ? ((body as { affiliates: { handle?: unknown; totalGmv?: unknown }[] }).affiliates)
    : null;
  if (!list) throw new Error('euka: the answer had no affiliates list');
  const rows = merge(list.map((a) => ({ handle: cleanHandle(a.handle), gmv: money(a.totalGmv) })));
  const reachedCap = list.length >= EUKA_CAP;
  const floor = reachedCap && rows.length ? Math.min(...rows.map((r) => r.gmv)) : null;
  /* a list that is full but already down to $0 lost nobody who sold: it is complete */
  const truncated = reachedCap && (floor ?? 0) > 0;
  return { rows, truncated, floor: truncated ? floor : null };
}

/** Reacher's creator performance pages: `{ data: [{ creator_handle, gmv }] }`, every creator. */
export function fromReacher(pages: unknown[]): { rows: CreatorGmv[]; truncated: false; floor: null } {
  const rows: CreatorGmv[] = [];
  for (const p of pages) {
    const data = (p as { data?: unknown })?.data;
    if (!Array.isArray(data)) throw new Error('reacher: a page had no data list');
    for (const r of data as { creator_handle?: unknown; gmv?: unknown }[]) {
      rows.push({ handle: cleanHandle(r.creator_handle), gmv: money(r.gmv) });
    }
  }
  return { rows: merge(rows), truncated: false, floor: null };
}

/* ───────────────────────────────── any range of days ───────────────────────────────── */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_RANGE_DAYS = 366;

/**
 * A date range somebody picked, made safe to ask the platforms about: both ends real days,
 * the start not after the end, the end no later than today (nothing has happened after it),
 * and no longer than a year. Null when it cannot be used.
 */
export function rangeWindow(from: unknown, to: unknown, today: Date): { start: string; end: string } | null {
  const f = String(from ?? '');
  const t = String(to ?? '');
  if (!DAY.test(f) || !DAY.test(t)) return null;
  const fd = Date.parse(`${f}T00:00:00Z`);
  const td = Date.parse(`${t}T00:00:00Z`);
  if (!Number.isFinite(fd) || !Number.isFinite(td)) return null;
  if (new Date(fd).toISOString().slice(0, 10) !== f || new Date(td).toISOString().slice(0, 10) !== t) return null;
  const todayMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const endMs = Math.min(td, todayMs);
  if (fd > endMs) return null;
  if ((endMs - fd) / 86_400_000 + 1 > MAX_RANGE_DAYS) return null;
  return { start: f, end: new Date(endMs).toISOString().slice(0, 10) };
}

/* ───────────────────── exact figures for creators below Euka's top 50 ─────────────────────
 *
 * Euka's top-creators report stops at 50, so a smaller creator showed "< $18". Euka also lists
 * every affiliate ORDER in a date range (one SKU line each, with the creator, price and
 * quantity), and the price times quantity added up per creator equals Euka's own total to the
 * cent (checked on Dr Tobias, 15 Oct 2026: philsmypharmacist 44.98, donniesdealss 41.18,
 * selfless.entrepreneur 33.28, all identical to the report). So for the creators we have on a
 * brand's roster who are not in the top 50, the orders give the exact figure.
 */

/** The creators on a brand's roster, and which handle each of their videos belongs to. */
export interface Roster {
  handles: Set<string>;
  /** TikTok video id -> the handle that posted it, for orders that name no creator. */
  owner: Map<string, string>;
}

/** A TikTok handle however a Paid Collabs row holds it: `@name`, `name`, or a profile link. */
export function rosterHandle(raw: unknown): string {
  const t = String(raw ?? '').trim().toLowerCase();
  if (!t) return '';
  const last = t.startsWith('http') ? (t.replace(/\/+$/, '').split('/').pop() ?? '') : t;
  return last.replace(/^@+/, '').split(/[?#]/)[0]!.trim();
}

/** The handle in a TikTok video link, or ''. */
export function linkHandle(url: unknown): string {
  return (/tiktok\.com\/@([^/?#]+)\/video\//i.exec(String(url ?? ''))?.[1] ?? '').trim().toLowerCase();
}

/** The video id in a TikTok video link, or ''. */
export function linkVideoId(url: unknown): string {
  return /\/video\/(\d+)/.exec(String(url ?? ''))?.[1] ?? '';
}

/**
 * Add up order pages per creator: price x quantity on every SKU line. An order that names no
 * creator (a partner-commission order) belongs to whoever posted the video it came from, when
 * that is one of ours; one we cannot place is left out, as it is in Euka's own list.
 */
export function sumOrders(pages: unknown[], roster: Roster): Map<string, number> {
  const sums = new Map<string, number>();
  for (const p of pages) {
    const orders = (p as { orders?: unknown })?.orders;
    if (!Array.isArray(orders)) throw new Error('euka: an orders page had no orders list');
    for (const o of orders as { skus?: unknown }[]) {
      for (const s of (Array.isArray(o?.skus) ? o.skus : []) as {
        creatorUsername?: unknown; contentId?: unknown; price?: unknown; quantity?: unknown;
      }[]) {
        const h = cleanHandle(s.creatorUsername) || roster.owner.get(String(s.contentId ?? '')) || '';
        if (!h) continue;
        const gmv = Number(s.price) * (Number(s.quantity) || 1);
        if (!Number.isFinite(gmv) || gmv <= 0) continue;
        sums.set(h, (sums.get(h) ?? 0) + gmv);
      }
    }
  }
  return sums;
}

/**
 * Euka's list, completed from the orders: the creators on the roster that the list did not reach
 * get the figure the orders give them (or nothing, which is $0). Only when every order page was
 * read: a partial sum is a lower bound, and a lower bound shown as a figure is wrong, so then the
 * list stays as it was, cut, and the screen keeps saying "less than".
 */
export function completeWithOrders(
  top: { rows: CreatorGmv[]; truncated: boolean; floor: number | null },
  sums: Map<string, number>,
  roster: Roster,
  complete: boolean,
): { rows: CreatorGmv[]; truncated: boolean; floor: number | null } {
  if (!top.truncated || !complete) return top;
  const listed = new Set(top.rows.map((r) => r.handle));
  const rows = [...top.rows];
  for (const h of roster.handles) {
    if (listed.has(h)) continue;
    const g = Math.round((sums.get(h) ?? 0) * 100) / 100;
    if (g > 0) rows.push({ handle: h, gmv: g });
  }
  return { rows, truncated: false, floor: null };
}

/* ───────────────────────── a creator's ad spend for a month, from Euka ─────────────────────────
 *
 * Rashid, 2026-11-06: the Performance sheet's October ad spend was wrong. It was added up from our
 * own copy of Euka's per-video GMV Max reports, and that copy stopped refreshing on 27 October (the
 * per-campaign report calls started answering 404), so October was missing its last days. Euka lists
 * every GMV Max creative for any dates, with the creator's handle and what it cost, so the month's
 * ad spend per creator is read from there directly, the same way the month's GMV is.
 */

/**
 * Add the cost of Euka's GMV Max creative rows per creator. A video that runs in two campaigns is
 * two rows and both count (the spend is real in each). Rows with no handle are left out: there is
 * nobody to put them against. Rounded to the cent once, at the end.
 */
export function sumCreatives(pages: unknown[]): CreatorGmv[] {
  const by = new Map<string, number>();
  for (const p of pages) {
    const rows = (p as { rows?: unknown })?.rows;
    if (!Array.isArray(rows)) throw new Error('euka: a creatives page had no rows list');
    for (const r of rows as { creatorHandle?: unknown; metrics?: { cost?: unknown } }[]) {
      const h = cleanHandle(r?.creatorHandle);
      const cost = Number(r?.metrics?.cost);
      if (!h || !Number.isFinite(cost) || cost <= 0) continue;
      by.set(h, (by.get(h) ?? 0) + cost);
    }
  }
  return [...by.entries()].map(([handle, gmv]) => ({ handle, gmv: Math.round(gmv * 100) / 100 }));
}
