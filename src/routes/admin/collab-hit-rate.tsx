import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import {
  KEYS,
  LABELS,
  applyDraft,
  asCriteria,
  chip,
  compact,
  describe,
  draftFrom,
  getApplied,
  keyOf,
  sameCriteria,
  setApplied,
  subscribe,
  validateDraft,
  wouldLeaveNone,
  type CriterionKey,
  type Draft,
  type HitCriteria,
} from '@/lib/admin/hit-criteria';

/**
 * A CREATOR'S HIT RATE, in the creator video popup and the Unique Creators list of Paid
 * Collabs -> Creators, under criteria the user chooses.
 *
 * Rashid, 2026-11-09: a video is a HIT when it meets any ENABLED condition: GMV in the last
 * 30 days, GMV in the last 90 days, or lifetime views, each with a threshold the user edits
 * and a switch to turn it off (at least one stays on). Changing them recomputes everything.
 *
 * THERE IS NO HIT LOGIC IN THIS FILE, ON PURPOSE. The rule, the dedupe by TikTok id, the
 * brand and overall counts, the ranking and every percentage are computed in the database
 * (`collab_creator_hit_stats`, `collab_creator_videos`, migration 20261109120000), over the
 * whole table rather than the rows this screen has loaded, from the criteria passed in each
 * call. This file only asks and draws.
 *
 * NO STALE ANSWERS. Every query's key contains the applied criteria, and nothing keeps the
 * previous result on screen while a new one loads, so a number is never shown under a
 * definition it was not computed with. The criteria themselves live in one shared store
 * (`@/lib/admin/hit-criteria`), so the popup, the people list and the page-level panel can
 * never disagree about which definition is active.
 *
 * Two things the figures never hide:
 *   - SAMPLE SIZE. Every rate is drawn beside the number of videos behind it, because 1 hit
 *     in 10 (10%) and 10 hits in 500 (2%) are different claims.
 *   - COVERAGE. GMV in the two windows comes from Euka, so a video Euka does not hold has
 *     those conditions UNVERIFIED (it can still qualify on views). The number of such
 *     videos is shown, so a creator on unconnected brands is not read as a weak one.
 */

type Stat = {
  creator_key: string;
  creator_name: string;
  brand: string | null;
  is_overall: boolean;
  total_videos: number;
  hit_videos: number;
  hit_rate: number | string;
  videos_per_hit: number | string | null;
  gmv_unverified_videos: number;
  metrics_from: string | null;
  metrics_to: string | null;
  hit_rank: number | null;
};

type HitVideo = {
  brand: string;
  item_id: string;
  video_url: string;
  thumb: string | null;
  posted_on: string | null;
  views: number | null;
  gmv_30d: number | string | null;
  gmv_90d: number | string | null;
  reasons: string[];
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pct = (v: unknown) => {
  const n = num(v);
  return n === null ? '–' : `${n.toFixed(2)}%`;
};
/** 30 -> "30", 23.57 -> "23.57", 32.5 -> "32.5". */
const per = (v: unknown) => {
  const n = num(v);
  return n === null ? null : String(Math.round(n * 100) / 100);
};
const usd = (v: unknown) => {
  const n = num(v);
  return n === null ? '–' : `$${Math.round(n).toLocaleString('en-US')}`;
};
const day = (iso: string | null) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

/** Every page of an RPC that can exceed PostgREST's 1,000-row cap, in a fixed order. */
async function rpcAll<T>(fn: string, args: Record<string, unknown>, orderBy: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await getSupabase()
      .rpc(fn, args)
      .order(orderBy)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/* ───────────────────────────── the shared criteria ───────────────────────────── */

/** The criteria in force: null = the defaults. Re-renders every user when it changes. */
export const useAppliedCriteria = (): HitCriteria | null => useSyncExternalStore(subscribe, getApplied, getApplied);

/** The factory settings, as the server holds them. */
export function useHitDefaults(): HitCriteria | undefined {
  const q = useQuery({
    queryKey: ['hit-rate', 'defaults'],
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('collab_hit_defaults');
      if (error) throw new Error(error.message);
      const c = asCriteria(data);
      if (!c) throw new Error('unreadable hit defaults');
      return c;
    },
    staleTime: Infinity,
  });
  return q.data;
}

/** "$2K+ GMV (30 days)" and friends, for the criteria a result was computed under. */
function reasonLabel(r: string, c: HitCriteria | undefined) {
  if (r === 'gmv_30d') return `${c ? `$${compact(c.gmv30.min)}+ ` : ''}GMV (30 days)`;
  if (r === 'gmv_90d') return `${c ? `$${compact(c.gmv90.min)}+ ` : ''}GMV (90 days)`;
  if (r === 'views') return `${c ? `${compact(c.views.min)}+ ` : ''}views`;
  return r;
}

/**
 * THE FILTER: which conditions make a hit. A compact, collapsible bar whose summary (the active
 * criteria) is always visible, so anyone reading a hit rate can see how it was calculated.
 * Edits are a draft until Apply; Apply writes the shared store, which re-asks the database.
 */
export function HitCriteriaPanel({ className }: { className?: string }) {
  const applied = useAppliedCriteria();
  const defaults = useHitDefaults();
  const effective = applied ?? defaults;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const appliedKey = keyOf(applied);
  const defaultsKey = defaults ? keyOf(defaults) : '';
  useEffect(() => {
    // follow the applied criteria (a change made in another panel, or a Reset) and the defaults arriving
    if (effective) setDraft(draftFrom(effective));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedKey, defaultsKey]);

  const check = draft ? validateDraft(draft) : null;
  const errors = check && !check.ok ? check.errors : {};
  const changed = !!(check?.ok && effective && !sameCriteria(check.criteria, effective));
  const canApply = !!(check?.ok && changed);
  const isDefault = applied === null;

  const apply = () => {
    if (check?.ok) applyDraft(check.criteria, defaults);
  };
  const reset = () => {
    setApplied(null);
    if (defaults) setDraft(draftFrom(defaults));
  };
  const set = (k: CriterionKey, patch: Partial<Draft[CriterionKey]>) =>
    setDraft((d) => (d ? { ...d, [k]: { ...d[k], ...patch } } : d));
  const toggle = (k: CriterionKey) => {
    if (!draft) return;
    // the last condition on cannot be switched off: a hit needs at least one test
    if (wouldLeaveNone(draft, k)) return;
    set(k, { on: !draft[k].on });
  };

  return (
    <section className={`pc-hc${className ? ` ${className}` : ''}`} aria-label="Hit criteria" onClick={(e) => e.stopPropagation()}>
      <div className="pc-hc-bar">
        <span className="pc-hc-title">Hit criteria</span>
        {effective ? (
          <span className="pc-hc-chips" aria-live="polite">
            {KEYS.filter((k) => effective[k].on).map((k) => (
              <span key={k} className="pc-hc-chip">{chip(k, effective[k])}</span>
            ))}
            <span className="pc-hc-or">any one qualifies</span>
            <span className={`pc-hc-tag${isDefault ? '' : ' custom'}`}>{isDefault ? 'Default' : 'Custom'}</span>
          </span>
        ) : (
          <span className="pc-hc-chips">Loading…</span>
        )}
        <button type="button" className="pc-hr-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Edit'}
        </button>
      </div>

      {open && draft && (
        <form
          className="pc-hc-body"
          onSubmit={(e) => {
            e.preventDefault();
            if (canApply) apply();
          }}
        >
          {KEYS.map((k) => (
            <div key={k} className={`pc-hc-row${draft[k].on ? '' : ' off'}`}>
              <button
                type="button"
                role="switch"
                aria-checked={draft[k].on}
                aria-label={`${LABELS[k].name} condition`}
                className="pc-hc-switch"
                onClick={() => toggle(k)}
                title={wouldLeaveNone(draft, k) ? 'At least one condition must stay on' : undefined}
              >
                <span />
              </button>
              <label className="pc-hc-lbl" htmlFor={`hc-${k}`}>
                <b>{LABELS[k].name}</b>
                <i>{LABELS[k].hint}</i>
              </label>
              <span className="pc-hc-input">
                <span aria-hidden>≥</span>
                {LABELS[k].unit === 'usd' && <span aria-hidden>$</span>}
                <input
                  id={`hc-${k}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={draft[k].min}
                  onChange={(e) => set(k, { min: e.target.value })}
                  aria-invalid={!!errors[k]}
                  aria-describedby={errors[k] ? `hc-${k}-err` : undefined}
                />
                {LABELS[k].unit === 'views' && <span aria-hidden>views</span>}
              </span>
              {errors[k] && <span id={`hc-${k}-err`} className="pc-hc-err" role="alert">{errors[k]}</span>}
            </div>
          ))}
          {errors.form && <p className="pc-hc-err" role="alert">{errors.form}</p>}
          <p className="pc-hr-note">
            A video is a hit when <b>any</b> enabled condition is met. It counts once however many it meets. Videos Euka holds no GMV for are
            checked on views only. Nothing here changes any video's data.
          </p>
          <div className="pc-hc-actions">
            <button type="submit" className="pc-hc-apply" disabled={!canApply}>Apply filters</button>
            <button type="button" className="pc-hr-link" onClick={reset} disabled={isDefault && !changed}>Reset to default</button>
          </div>
        </form>
      )}
    </section>
  );
}

/* ───────────────────────────── everyone, for the list ───────────────────────────── */

export type PersonHits = { videos: number; hits: number; rate: number | null; perHit: number | null; rank: number | null };

/**
 * EVERY PERSON'S TOTALS, for the Unique Creators list, keyed by the same lower-cased name that
 * list groups on, under the applied criteria. One call returns a row per person (not per
 * video): the database does the counting and the ranking. A person with no published videos has
 * no entry, which the list draws as a dash. While a new criteria set is computing there is NO
 * entry for anyone, rather than the old numbers.
 */
export function useHitRateByCreator(): { byKey: Map<string, PersonHits>; loading: boolean; failed: boolean } {
  const applied = useAppliedCriteria();
  const q = useQuery({
    queryKey: ['hit-rate', 'everyone', keyOf(applied)],
    queryFn: async () => {
      const rows = await rpcAll<Stat>('collab_creator_hit_stats', { p_overall_only: true, p_criteria: applied }, 'creator_key');
      return new Map(
        rows.map(
          (r) =>
            [
              r.creator_key,
              { videos: r.total_videos, hits: r.hit_videos, rate: num(r.hit_rate), perHit: num(r.videos_per_hit), rank: r.hit_rank },
            ] as const
        )
      );
    },
    staleTime: 60_000,
  });
  return { byKey: q.data ?? EMPTY, loading: q.isPending, failed: q.isError };
}
const EMPTY = new Map<string, PersonHits>();

/** "4.24%" with "7 of 165" under it: the rate never appears without its sample. */
export function HitRateCell({ hit }: { hit: PersonHits | undefined }) {
  if (!hit || hit.videos === 0) return <span className="pc-handle">-</span>;
  return (
    <span
      className="pc-hr-cell"
      title={`${hit.hits} hit video${hit.hits === 1 ? '' : 's'} out of ${hit.videos} published${
        hit.perHit !== null ? ` · ${per(hit.perHit)} videos per hit` : ' · no hits yet'
      }${hit.rank ? ` · rank ${hit.rank}` : ''}`}
    >
      <b>{pct(hit.rate)}</b>
      <i>
        {hit.hits} of {hit.videos}
      </i>
    </span>
  );
}

/* ───────────────────────────── one creator ───────────────────────────── */

export function CreatorHitRate({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  const [brand, setBrand] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showHits, setShowHits] = useState(false);

  const applied = useAppliedCriteria();
  const defaults = useHitDefaults();
  const effective = applied ?? defaults;
  const ck = keyOf(applied);

  const args = {
    p_creator: name,
    p_brand: brand || null,
    p_from: from || null,
    p_to: to || null,
    p_criteria: applied,
  };

  // The unfiltered brand list, so choosing a brand does not make the picker forget the others.
  // Brand names do not depend on the criteria, so this is asked once per creator.
  const brands = useQuery({
    queryKey: ['hit-rate', 'brands', name],
    queryFn: async () => {
      const rows = await rpcAll<Stat>('collab_creator_hit_stats', { p_creator: name }, 'brand');
      return rows.filter((r) => !r.is_overall).map((r) => r.brand ?? '').sort();
    },
    staleTime: 60_000,
  });

  const stats = useQuery({
    queryKey: ['hit-rate', 'stats', name, brand, from, to, ck],
    queryFn: () => rpcAll<Stat>('collab_creator_hit_stats', args, 'brand'),
    staleTime: 60_000,
  });

  // Only the hit videos, found by the database under the same criteria and filters as the counts.
  const hits = useQuery({
    queryKey: ['hit-rate', 'videos', name, brand, from, to, ck],
    queryFn: async () => {
      const rows = await rpcAll<HitVideo>('collab_creator_videos', { ...args, p_hits_only: true }, 'item_id');
      return rows.sort((a, b) => (num(b.gmv_90d) ?? 0) - (num(a.gmv_90d) ?? 0) || (b.views ?? 0) - (a.views ?? 0));
    },
    enabled: open && showHits,
    staleTime: 60_000,
  });

  const overall = stats.data?.find((r) => r.is_overall);
  const byBrand = useMemo(() => (stats.data ?? []).filter((r) => !r.is_overall), [stats.data]);
  const total = overall?.total_videos ?? 0;
  const hitN = overall?.hit_videos ?? 0;
  const filtered = !!(brand || from || to);
  const summary = stats.isPending
    ? 'Hit rate…'
    : stats.isError
      ? 'Hit rate unavailable'
      : total === 0
        ? filtered
          ? 'Hit rate · no videos in this filter'
          : 'Hit rate · no published videos yet'
        : `Hit rate ${pct(overall?.hit_rate)} · ${hitN} hit${hitN === 1 ? '' : 's'} of ${total} video${total === 1 ? '' : 's'} · ${brand || 'all brands'}`;

  return (
    <div className="pc-hr" onClick={(e) => e.stopPropagation()} aria-busy={stats.isFetching}>
      <button
        type="button"
        className="pc-hr-toggle"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={effective ? `A video is a hit with ${describe(effective)}` : undefined}
      >
        <span className="pc-hr-chev" aria-hidden>{open ? '▾' : '▸'}</span>
        <span className="pc-hr-sum">{summary}</span>
        {overall && overall.hit_videos > 0 && (
          <span className="pc-hr-sum-per">
            {per(overall.videos_per_hit)} videos per hit (observed)
          </span>
        )}
      </button>

      {open && (
        <div className="pc-hr-body">
          <HitCriteriaPanel />
          <div className="pc-hr-filters">
            <label>
              Brand
              <select value={brand} onChange={(e) => setBrand(e.target.value)}>
                <option value="">All brands</option>
                {[...new Set(brands.data ?? [])].map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </label>
            <label>
              Posted from
              <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              to
              <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
            </label>
            {filtered && (
              <button type="button" className="pc-hr-link" onClick={() => { setBrand(''); setFrom(''); setTo(''); }}>
                Clear
              </button>
            )}
          </div>
          {(from || to) && (
            <p className="pc-hr-note">
              Filtered by the day each video was <b>posted</b>; videos with no posted date are left out. The 30 and 90 day GMV windows are
              separate and always end on the day the figures were last refreshed.
            </p>
          )}

          {stats.isError && <p className="pc-hr-note pc-hr-err" role="alert">Could not load the hit rate.</p>}
          {stats.isFetching && !stats.isError && <p className="pc-hr-note">Recalculating…</p>}

          {!stats.isPending && !stats.isError && (
            <>
              <div className="pc-hr-kpis">
                <div className="pc-hr-kpi"><span>Total videos</span><b>{total}</b></div>
                <div className="pc-hr-kpi"><span>Hit videos</span><b>{hitN}</b></div>
                <div className="pc-hr-kpi">
                  <span>Hit rate</span>
                  <b>{total ? pct(overall?.hit_rate) : '–'}</b>
                  {total > 0 && <i>of {total} video{total === 1 ? '' : 's'}</i>}
                </div>
                <div className="pc-hr-kpi">
                  <span>Videos per hit (observed)</span>
                  <b>{total === 0 ? '–' : hitN > 0 ? per(overall?.videos_per_hit) : 'No hits yet'}</b>
                </div>
              </div>

              {overall && overall.gmv_unverified_videos > 0 && (
                <p className="pc-hr-note">
                  GMV could not be checked for <b>{overall.gmv_unverified_videos}</b> of {total} videos (brands or videos Euka does not hold). Those can
                  still qualify on views, so this rate may be understated.
                </p>
              )}
              {overall?.metrics_from && (
                <p className="pc-hr-note">
                  GMV windows end {overall.metrics_from === overall.metrics_to
                    ? day(overall.metrics_from)
                    : `${day(overall.metrics_from)} to ${day(overall.metrics_to)}`}.
                </p>
              )}

              {byBrand.length > 0 && (
                <table className="pc-hr-table">
                  <thead>
                    <tr><th>Brand</th><th>Total videos</th><th>Hit videos</th><th>Hit rate</th><th>Videos per hit</th></tr>
                  </thead>
                  <tbody>
                    {byBrand.map((r) => (
                      <tr key={r.brand ?? ''}>
                        <td>{r.brand}</td>
                        <td>{r.total_videos}</td>
                        <td>{r.hit_videos}</td>
                        <td>{pct(r.hit_rate)}</td>
                        <td>{r.hit_videos > 0 ? per(r.videos_per_hit) : 'No hits yet'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {hitN > 0 && (
                <button type="button" className="pc-hr-link pc-hr-showhits" onClick={() => setShowHits((s) => !s)} aria-expanded={showHits}>
                  {showHits ? 'Hide hit videos' : `View the ${hitN} hit video${hitN === 1 ? '' : 's'}`}
                </button>
              )}
            </>
          )}

          {showHits && (
            <div className="pc-hr-hits">
              {hits.isPending && <p className="pc-hr-note">Loading…</p>}
              {hits.isError && <p className="pc-hr-note pc-hr-err" role="alert">Could not load the hit videos.</p>}
              {hits.data?.map((v) => (
                <div className="pc-hr-hit" key={v.item_id}>
                  <a href={v.video_url} target="_blank" rel="noreferrer" className="pc-hr-thumb" title="Open on TikTok">
                    {v.thumb ? <img src={v.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden>▶</span>}
                  </a>
                  <div className="pc-hr-hit-main">
                    <div className="pc-hr-hit-top">
                      <a href={v.video_url} target="_blank" rel="noreferrer">Open on TikTok</a>
                      <span className="pc-hr-brand">{v.brand}</span>
                      {v.posted_on && <span className="pc-hr-date">posted {day(v.posted_on)}</span>}
                    </div>
                    <div className="pc-hr-hit-nums">
                      <span><i>Views</i> {v.views === null ? '–' : v.views.toLocaleString('en-US')}</span>
                      <span><i>GMV 30d</i> {usd(v.gmv_30d)}</span>
                      <span><i>GMV 90d</i> {usd(v.gmv_90d)}</span>
                    </div>
                    <div className="pc-hr-reasons">
                      {v.reasons.map((r) => (
                        <span key={r} className="pc-hr-reason">HIT: {reasonLabel(r, effective)}</span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
