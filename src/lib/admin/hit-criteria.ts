/**
 * THE CRITERIA A USER CHOOSES FOR WHAT COUNTS AS A HIT VIDEO.
 *
 * Rashid, 2026-11-09: the three conditions (GMV in the last 30 days, GMV in the last 90
 * days, lifetime views) each get an on/off switch and a threshold the user edits, and
 * everything (hit counts, rates, videos per hit, brand rows, rankings, the lists) must
 * recompute from them.
 *
 * THIS FILE DECIDES NOTHING ABOUT A HIT. It only holds what the user typed, checks it,
 * and remembers it. The classification and every aggregate happen in the database
 * (`collab_creator_videos`, `collab_creator_hit_stats`, migration 20261109120000), which is
 * handed these criteria on every call: nothing is precomputed, cached against a previous
 * choice, or stored on a video. The factory settings are not written here either: they are
 * read from `collab_hit_defaults()`, so the number a person sees on "Reset" is the number the
 * server uses when it is passed nothing.
 *
 * `null` MEANS "THE DEFAULTS", not a copy of them. Applying criteria equal to the defaults
 * stores `null`, so "Default" is a state the screen can name and the server resolves.
 *
 * Pure and React-free on purpose, so `pnpm verify:hit-criteria` can test it in Node.
 */

export const KEYS = ['gmv30', 'gmv90', 'views'] as const;
export type CriterionKey = (typeof KEYS)[number];

export type Criterion = { on: boolean; min: number };
export type HitCriteria = Record<CriterionKey, Criterion>;

/** The editable form: thresholds are text while the user is typing. */
export type DraftRow = { on: boolean; min: string };
export type Draft = Record<CriterionKey, DraftRow>;

export const LABELS: Record<CriterionKey, { name: string; unit: 'usd' | 'views'; hint: string }> = {
  gmv30: { name: 'GMV (last 30 days)', unit: 'usd', hint: "The video's own sales in the 30 days to the last refresh" },
  gmv90: { name: 'GMV (last 90 days)', unit: 'usd', hint: "The video's own sales in the 90 days to the last refresh" },
  views: { name: 'Video views', unit: 'views', hint: 'Lifetime views of the TikTok video' },
};

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * "2000", "$2,000", "2k", "1.5m" -> a number; anything else -> null. A thousands comma and a
 * leading $ are ignored; k and m are accepted because 500k is how people write 500,000.
 */
export function parseAmount(text: string): number | null {
  const t = String(text ?? '').trim().replace(/[$,\s]/g, '').toLowerCase();
  const m = /^(\d+(?:\.\d+)?|\.\d+)([km])?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1);
  return finite(n) ? Math.round(n * 100) / 100 : null;
}

export const draftFrom = (c: HitCriteria): Draft => ({
  gmv30: { on: c.gmv30.on, min: String(c.gmv30.min) },
  gmv90: { on: c.gmv90.on, min: String(c.gmv90.min) },
  views: { on: c.views.on, min: String(c.views.min) },
});

export type Validation =
  | { ok: true; criteria: HitCriteria }
  | { ok: false; errors: Partial<Record<CriterionKey | 'form', string>> };

/**
 * A draft is valid when every threshold (on or off) is a non-negative number and at least one
 * condition is on. Disabled rows are checked too, so what is saved is always well-formed.
 */
export function validateDraft(d: Draft): Validation {
  const errors: Partial<Record<CriterionKey | 'form', string>> = {};
  const out = {} as HitCriteria;
  for (const k of KEYS) {
    const n = parseAmount(d[k].min);
    if (n === null) errors[k] = 'Enter a number, 0 or more';
    else out[k] = { on: !!d[k].on, min: n };
  }
  if (!KEYS.some((k) => d[k].on)) errors.form = 'Keep at least one condition on';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, criteria: out };
}

/** Whether turning `key` off would leave nothing on. */
export const wouldLeaveNone = (d: Draft, key: CriterionKey) => d[key].on && KEYS.filter((k) => d[k].on).length === 1;

export const sameCriteria = (a: HitCriteria, b: HitCriteria) =>
  KEYS.every((k) => a[k].on === b[k].on && a[k].min === b[k].min);

/** A stored/untrusted value as criteria, or null if it is not exactly well-formed. */
export function asCriteria(v: unknown): HitCriteria | null {
  if (!v || typeof v !== 'object') return null;
  const out = {} as HitCriteria;
  for (const k of KEYS) {
    const c = (v as Record<string, unknown>)[k] as { on?: unknown; min?: unknown } | undefined;
    if (!c || typeof c.on !== 'boolean' || !finite(c.min) || c.min < 0) return null;
    out[k] = { on: c.on, min: c.min };
  }
  return KEYS.some((k) => out[k].on) ? out : null;
}

/** 1500 -> "1.5K", 250000 -> "250K", 2000000 -> "2M". Exact below 1,000. */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2).replace(/\.?0+$/, '')}K`;
  return String(Math.round(n * 100) / 100);
}

/** One enabled condition, as a short chip: "GMV 30d ≥ $2K", "Views ≥ 500K". */
export function chip(k: CriterionKey, c: Criterion): string {
  const v = LABELS[k].unit === 'usd' ? `$${compact(c.min)}` : compact(c.min);
  return `${k === 'views' ? 'Views' : k === 'gmv30' ? 'GMV 30d' : 'GMV 90d'} ≥ ${v}`;
}

/** The enabled conditions, joined the way the rule works: any one is enough. */
export const describe = (c: HitCriteria): string => KEYS.filter((k) => c[k].on).map((k) => chip(k, c[k])).join(' or ');

/* ───────────── the applied criteria: one value the whole Creators area shares ─────────────
   `null` = defaults. Kept in the browser so a person's preferred definition survives a
   reload, but never required: if storage is blocked or holds junk, it is the defaults. */

const STORAGE_KEY = 'wx-hit-criteria:v1';
let applied: HitCriteria | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    applied = raw ? asCriteria(JSON.parse(raw)) : null;
  } catch {
    applied = null;
  }
}

export function getApplied(): HitCriteria | null {
  load();
  return applied;
}

/** Apply criteria (null = defaults). Everything subscribed re-asks the database. */
export function setApplied(c: HitCriteria | null) {
  load();
  applied = c;
  try {
    if (c) storage()?.setItem(STORAGE_KEY, JSON.stringify(c));
    else storage()?.removeItem(STORAGE_KEY);
  } catch {
    /* storage is a convenience, never a requirement */
  }
  listeners.forEach((l) => l());
}

export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Apply a validated draft, collapsing "equal to the defaults" to null. */
export function applyDraft(c: HitCriteria, defaults: HitCriteria | undefined) {
  setApplied(defaults && sameCriteria(c, defaults) ? null : c);
}

/** What goes to the database: the applied criteria, or null for "use your defaults". */
export const payloadOf = (c: HitCriteria | null): HitCriteria | null => c;

/** A stable cache key for the criteria, so a different choice can never reuse an old answer. */
export const keyOf = (c: HitCriteria | null): string => (c ? JSON.stringify(KEYS.map((k) => [c[k].on, c[k].min])) : 'default');

/** Test hook: forget everything, as a fresh page load would. */
export function _resetForTests() {
  applied = null;
  loaded = false;
  listeners.clear();
}
