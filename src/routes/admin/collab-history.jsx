/**
 * HISTORY: EVERY BRAND WE HAVE WORKED WITH AND EVERY CREATOR WHO WAS EVER PAID
 * BY EACH, WITH WHAT THEY SELL FOR THE BRAND IN ANY MONTH.
 *
 * Rashid, 2026-11-27. Two things must never be confused here:
 *
 *   COLLABORATION MONTH  the month a creator was hired (`hiring_date`) for the
 *                        brand. History, permanent. A creator stays on the page
 *                        when she is no longer active or sold nothing.
 *   GMV MONTH            the month the SALES happened, whenever the video was
 *                        posted. A June video that sells in November counts in
 *                        November.
 *
 * WHERE EACH NUMBER COMES FROM, AND WHAT THAT CAN AND CANNOT SAY
 *   Who and when       `wurxbase.creators`, one row per hire. Nothing here deletes
 *                      or hides a row, so history is whatever the roster holds.
 *   Monthly GMV        `collab_creator_month_gmv`, which `collab-gmv-sync` copies
 *                      from Euka or Reacher: GMV per creator, per brand, per SALES
 *                      month, one frozen row per month once it has settled. That is
 *                      the most granular monthly attribution either platform gives.
 *   Per video          the roster keeps ONE running total per video. It is shown as
 *                      "to date" and is never split into months, because nothing
 *                      here knows how much of it fell in which month.
 *
 * FOUR HONEST STATES FOR A MONTH'S GMV, never blurred together:
 *   a figure           the platform reported sales for her that month
 *   $0                 the month was read in full and she is not in it
 *   under $X           Euka answers a brand's top 50 only; she is not in a full list,
 *                      so she made less than the 50th creator did
 *   a dash             that month was never read for this brand: no data, not zero
 *
 * Totals are over the creators on OUR roster, so a creator is never counted twice.
 * Sales by people not on the roster are shown apart, never added in.
 */
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSupabase } from '@/lib/supabase';
import { brandLogo } from '@/lib/brand-logos';
import { handleKey, identitiesOf } from './collab-month-compare';

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const monthLabel = (k) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(k || ''));
  if (!m) return '–';
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleString('en-US', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
};
const nowKey = () => new Date().toISOString().slice(0, 7);
const brandOf = (c) => String((c && c.brand) || '').trim();
const slugOf = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ─── the monthly GMV the platforms reported, every brand and month ─────────── */

const PAGE = 1000;

async function readPaged(build) {
  const first = await build(0, PAGE - 1, true);
  if (first.error) throw new Error(first.error.message);
  const rows = [...(first.data || [])];
  const total = first.count ?? rows.length;
  const jobs = [];
  for (let from = PAGE; from < total; from += PAGE) jobs.push(build(from, from + PAGE - 1, false));
  const rest = await Promise.all(jobs);
  rest.forEach((r) => {
    if (r.error) throw new Error(r.error.message);
    rows.push(...(r.data || []));
  });
  return rows;
}

async function readMonthlyGmv() {
  const db = getSupabase();
  const metas = await readPaged((a, b, count) =>
    db
      .from('collab_brand_month_gmv')
      .select('brand, month, source, truncated, floor_gmv', count ? { count: 'exact' } : undefined)
      .order('brand')
      .order('month')
      .range(a, b)
  );
  const gmv = await readPaged((a, b, count) =>
    db
      .from('collab_creator_month_gmv')
      .select('brand, month, handle, gmv', count ? { count: 'exact' } : undefined)
      .order('brand')
      .order('month')
      .order('handle')
      .range(a, b)
  );
  /* brand -> month -> { source, truncated, floor, byHandle } */
  const byBrand = new Map();
  metas.forEach((m) => {
    const k = String(m.brand).trim();
    if (!byBrand.has(k)) byBrand.set(k, new Map());
    byBrand.get(k).set(m.month, {
      source: m.source,
      truncated: !!m.truncated,
      floor: m.floor_gmv === null ? null : Number(m.floor_gmv),
      byHandle: new Map(),
      total: 0,
    });
  });
  gmv.forEach((r) => {
    const mo = byBrand.get(String(r.brand).trim())?.get(r.month);
    if (!mo) return;
    const g = Number(r.gmv) || 0;
    mo.byHandle.set(handleKey(r.handle), g);
    mo.total += g;
  });
  return byBrand;
}

/* ─── people: one per creator, whichever hire rows they sit on ───────────────── */

const videoKey = (v) => {
  const url = String((v && v.video) || '').trim();
  if (!url) return '';
  return (/video\/(\d+)/.exec(url) || [])[1] || url;
};

function groupPeople(rows, deliveredVideoCount) {
  const byId = new Map();
  const people = [];
  rows.forEach((c) => {
    const ids = identitiesOf(c);
    let p = ids.map((i) => byId.get(i)).find(Boolean);
    if (!p) {
      p = { name: c.name || ids[0] || 'Unnamed', handles: new Set(), rows: [] };
      people.push(p);
    }
    p.rows.push(c);
    [c.tiktok_account, c.tiktok_account_2].map(handleKey).filter(Boolean).forEach((h) => p.handles.add(h));
    ids.forEach((i) => byId.set(i, p));
  });
  return people.map((p) => {
    const rowsSorted = [...p.rows].sort((a, b) => String(a.hiring_date || '').localeCompare(String(b.hiring_date || '')));
    const vids = new Map();
    const products = new Map();
    rowsSorted.forEach((c) =>
      (Array.isArray(c.video_codes) ? c.video_codes : []).forEach((v) => {
        const k = videoKey(v);
        if (!k) return;
        const cur = vids.get(k);
        vids.set(k, { ...v, revenue: Math.max(Number(cur && cur.revenue) || 0, Number(v.revenue) || 0) });
        const pr = String(v.product || '').trim();
        if (pr) products.set(pr, (products.get(pr) || 0) + 1);
      })
    );
    const last = rowsSorted[rowsSorted.length - 1];
    return {
      key: [...p.handles][0] || `n:${String(p.name).toLowerCase()}`,
      name: p.name,
      handles: [...p.handles],
      rows: rowsSorted,
      hireMonths: [...new Set(rowsSorted.map((c) => String(c.hiring_date || '').slice(0, 7)).filter(Boolean))],
      lastHire: String((last && last.hiring_date) || ''),
      last,
      videos: [...vids.values()].sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))),
      delivered: rowsSorted.reduce((n, c) => n + (deliveredVideoCount ? deliveredVideoCount(c) : 0), 0),
      products: [...products.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n),
    };
  });
}

/** What one creator made in one month, in one of the four honest states. */
function gmvIn(brandMonths, month, handles) {
  const mo = brandMonths && brandMonths.get(month);
  if (!mo || !handles.length) return { state: 'none' };
  let v = 0;
  let hit = false;
  handles.forEach((h) => {
    if (mo.byHandle.has(h)) {
      hit = true;
      v += mo.byHandle.get(h);
    }
  });
  if (hit) return { state: 'value', v };
  if (mo.truncated) return { state: 'under', floor: mo.floor };
  return { state: 'zero', v: 0 };
}

function Cell({ cell }) {
  if (cell.state === 'value') return <b>{usd(cell.v)}</b>;
  if (cell.state === 'zero') return <span title="The month was read in full and she is not in it">$0</span>;
  if (cell.state === 'under')
    return (
      <span title="Euka reports a brand's top 50 creators only. She is not in that list, so she made less than the 50th did.">
        {cell.floor !== null ? `under ${usd(cell.floor)}` : 'below top 50'}
      </span>
    );
  return (
    <span className="wx-hist-nodata" title="This month was never read for this brand. That is missing data, not zero.">
      –
    </span>
  );
}

/* ─── pieces ─────────────────────────────────────────────────────────────────── */

function Stat({ label, value, sub }) {
  return (
    <div className="wx-hist-stat">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <em>{sub}</em>}
    </div>
  );
}

function Mark({ name, size = 40 }) {
  const logo = brandLogo(slugOf(name), null);
  return logo ? (
    <img className="wx-hist-logo" src={logo} alt="" width={size} height={size} />
  ) : (
    <span className="wx-hist-logo init" style={{ width: size, height: size }}>
      {(name || '?')[0].toUpperCase()}
    </span>
  );
}

/** Bars of monthly GMV, newest on the right. A missing month is a gap, never a zero bar. */
function MonthBars({ months, valueOf, onLabel }) {
  const vals = months.map((m) => valueOf(m));
  const top = Math.max(1, ...vals.map((c) => (c.state === 'value' ? c.v : 0)));
  return (
    <div className="wx-hist-bars" role="img" aria-label="Monthly GMV">
      {months.map((m, i) => {
        const c = vals[i];
        const h = c.state === 'value' ? Math.max(3, (c.v / top) * 100) : 0;
        return (
          <div key={m} className="wx-hist-bar" title={`${monthLabel(m)}: ${onLabel(c)}`}>
            <i className={c.state} style={{ height: `${h}%` }} />
            <span>{monthLabel(m).split(' ')[0]}</span>
          </div>
        );
      })}
    </div>
  );
}
const cellText = (c) =>
  c.state === 'value' ? usd(c.v) : c.state === 'zero' ? '$0' : c.state === 'under' ? 'under top-50 floor' : 'no data';

/* ─── the screen ─────────────────────────────────────────────────────────────── */

export function CollabHistory({ creators, helpers }) {
  const [brand, setBrand] = useState('');
  const [personKey, setPersonKey] = useState('');
  const [search, setSearch] = useState('');
  const [collabMonth, setCollabMonth] = useState('');
  const [gmvMonth, setGmvMonth] = useState(nowKey());
  const [sort, setSort] = useState('gmv');

  const q = useQuery({ queryKey: ['history-monthly-gmv'], queryFn: readMonthlyGmv, staleTime: 5 * 60_000, retry: 1 });
  const gmvStore = q.data || new Map();
  const Face = helpers && helpers.CreatorFace;

  const brands = useMemo(() => {
    const by = new Map();
    (creators || []).forEach((c) => {
      const b = brandOf(c);
      if (b) (by.get(b) || by.set(b, []).get(b)).push(c);
    });
    return [...by.entries()].map(([name, rows]) => {
      const people = groupPeople(rows, helpers && helpers.deliveredVideoCount);
      const months = gmvStore.get(name) || new Map();
      const monthKeys = [...months.keys()].sort();
      const series = monthKeys.map((m) => ({
        m,
        v: people.reduce((t, p) => {
          const c = gmvIn(months, m, p.handles);
          return t + (c.state === 'value' ? c.v : 0);
        }, 0),
      }));
      return {
        name,
        rows,
        people,
        series,
        lifetime: series.reduce((t, s) => t + s.v, 0),
        firstMonth: monthKeys[0] || '',
        videos: people.reduce((t, p) => t + p.videos.length, 0),
        last: rows.reduce((m, c) => (String(c.hiring_date || '') > m ? String(c.hiring_date) : m), ''),
      };
    });
  }, [creators, gmvStore, helpers]);

  const cur = brand ? brands.find((b) => b.name === brand) : null;
  const person = cur && personKey ? cur.people.find((p) => p.key === personKey) : null;

  if (!creators) return <p className="wx-hist-note">Loading…</p>;

  /* ── creator page ── */
  if (cur && person) {
    const months = gmvStore.get(cur.name) || new Map();
    const monthKeys = [...new Set([...months.keys(), nowKey()])].sort();
    const cells = monthKeys.map((m) => gmvIn(months, m, person.handles));
    const lifetime = cells.reduce((t, c) => t + (c.state === 'value' ? c.v : 0), 0);
    const latest = [...monthKeys].reverse().find((m) => {
      const c = gmvIn(months, m, person.handles);
      return c.state === 'value' && c.v > 0;
    });
    return (
      <div className="wx-hist">
        <button type="button" className="wx-hist-back" onClick={() => setPersonKey('')}>
          ‹ {cur.name}
        </button>
        <section className="wx-hist-card wx-hist-who">
          {Face ? <Face handle={person.handles[0]} name={person.name} size={56} /> : <span className="wx-hist-logo init">{person.name[0]}</span>}
          <div>
            <h2>{person.name}</h2>
            <p>
              {person.handles.map((h) => (
                <a key={h} href={`https://www.tiktok.com/@${h}`} target="_blank" rel="noreferrer">
                  @{h}
                </a>
              ))}
              <span> · {cur.name}</span>
            </p>
          </div>
          <div className="wx-hist-stats">
            <Stat label="GMV for this brand" value={usd(lifetime)} sub={cur.firstMonth ? `since ${monthLabel(cur.firstMonth)}` : 'no months read'} />
            <Stat label="Videos" value={person.videos.length} sub={`${person.delivered} delivered`} />
            <Stat label="Latest GMV" value={latest ? monthLabel(latest) : '–'} />
          </div>
        </section>

        <section className="wx-hist-card">
          <h3>GMV by sales month</h3>
          <p className="wx-hist-note">
            The month the sales happened, from every video of hers for this brand, including older ones. Platforms do not split a
            creator's month by video, so it is shown per creator.
          </p>
          <MonthBars months={monthKeys} valueOf={(m) => gmvIn(months, m, person.handles)} onLabel={cellText} />
          <table className="wx-hist-table compact">
            <thead>
              <tr>
                <th>Month</th>
                <th className="r">GMV</th>
              </tr>
            </thead>
            <tbody>
              {[...monthKeys].reverse().map((m) => (
                <tr key={m}>
                  <td>{monthLabel(m)}</td>
                  <td className="r">
                    <Cell cell={gmvIn(months, m, person.handles)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="wx-hist-card">
          <h3>Collaborations with {cur.name}</h3>
          <table className="wx-hist-table">
            <thead>
              <tr>
                <th>Hired</th>
                <th>Deal</th>
                <th>Videos</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {person.rows.map((c, i) => (
                <tr key={c.id || i}>
                  <td>{c.hiring_date ? `${monthLabel(String(c.hiring_date).slice(0, 7))} · ${String(c.hiring_date).slice(0, 10)}` : '–'}</td>
                  <td>{c.deal || '–'}</td>
                  <td>{c.videos || '–'}</td>
                  <td>{c.payment_status || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="wx-hist-card">
          <h3>Videos ({person.videos.length})</h3>
          <p className="wx-hist-note">GMV here is each video's running total to date, not a month.</p>
          {person.videos.length === 0 ? (
            <p className="wx-hist-note">No videos on record.</p>
          ) : (
            <table className="wx-hist-table">
              <thead>
                <tr>
                  <th>Posted</th>
                  <th>Product</th>
                  <th className="r">Views</th>
                  <th className="r">GMV to date</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {person.videos.map((v) => (
                  <tr key={videoKey(v)}>
                    <td>{String(v.date || '').slice(0, 10) || '–'}</td>
                    <td className="clip" title={v.product || ''}>
                      {v.product || '–'}
                    </td>
                    <td className="r">{Number(v.views) ? Number(v.views).toLocaleString('en-US') : '–'}</td>
                    <td className="r">{Number(v.revenue) > 0 ? usd(Number(v.revenue)) : '–'}</td>
                    <td>
                      <a href={v.video} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    );
  }

  /* ── brand page ── */
  if (cur) {
    const months = gmvStore.get(cur.name) || new Map();
    const gmvMonths = [...new Set([...months.keys(), nowKey()])].sort().reverse();
    const collabMonths = [...new Set(cur.people.flatMap((p) => p.hireMonths))].sort().reverse();
    const meta = months.get(gmvMonth);
    const rows = cur.people
      .filter((p) => !collabMonth || p.hireMonths.includes(collabMonth))
      .filter((p) => {
        const s = search.trim().toLowerCase();
        return !s || p.name.toLowerCase().includes(s) || p.handles.some((h) => h.includes(s.replace(/^@/, '')));
      })
      .map((p) => {
        const cell = gmvIn(months, gmvMonth, p.handles);
        const life = [...months.keys()].reduce((t, m) => {
          const c = gmvIn(months, m, p.handles);
          return t + (c.state === 'value' ? c.v : 0);
        }, 0);
        const latest = [...months.keys()].sort().reverse().find((m) => {
          const c = gmvIn(months, m, p.handles);
          return c.state === 'value' && c.v > 0;
        });
        return { p, cell, life, latest };
      });
    rows.sort((a, b) =>
      sort === 'name'
        ? a.p.name.localeCompare(b.p.name)
        : sort === 'recent'
          ? b.p.lastHire.localeCompare(a.p.lastHire)
          : sort === 'life'
            ? b.life - a.life
            : (b.cell.state === 'value' ? b.cell.v : -1) - (a.cell.state === 'value' ? a.cell.v : -1) || b.life - a.life
    );
    const earning = cur.people.filter((p) => {
      const c = gmvIn(months, gmvMonth, p.handles);
      return c.state === 'value' && c.v > 0;
    });
    const rosterTotal = earning.reduce((t, p) => t + gmvIn(months, gmvMonth, p.handles).v, 0);
    const others = meta ? Math.max(0, meta.total - rosterTotal) : 0;
    const videosContributing = earning.reduce((t, p) => t + p.videos.length, 0);

    return (
      <div className="wx-hist">
        <button type="button" className="wx-hist-back" onClick={() => { setBrand(''); setSearch(''); setCollabMonth(''); }}>
          ‹ All brands
        </button>
        <section className="wx-hist-card wx-hist-who">
          <Mark name={cur.name} size={56} />
          <div>
            <h2>{cur.name}</h2>
            <p>
              {cur.people.length} creators · {cur.rows.length} paid collaborations · last hired {cur.last ? cur.last.slice(0, 10) : '–'}
            </p>
          </div>
          <div className="wx-hist-filters">
            <label>
              GMV month
              <select value={gmvMonth} onChange={(e) => setGmvMonth(e.target.value)}>
                {gmvMonths.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Collaboration month
              <select value={collabMonth} onChange={(e) => setCollabMonth(e.target.value)}>
                <option value="">All months</option>
                {collabMonths.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="wx-hist-card">
          <h3>{monthLabel(gmvMonth)}, by sales date</h3>
          {!meta && <p className="wx-hist-note">This month has not been read for {cur.name} yet, so there is no GMV to show (not $0).</p>}
          <div className="wx-hist-stats wide">
            <Stat label="GMV, our creators" value={meta ? usd(rosterTotal) : '–'} sub={meta && others > 0 ? `+ ${usd(others)} from creators not on our roster` : undefined} />
            <Stat label="Creators with GMV" value={meta ? earning.length : '–'} sub={`of ${cur.people.length} on record`} />
            <Stat label="Avg per earning creator" value={meta && earning.length ? usd(rosterTotal / earning.length) : '–'} />
            <Stat label="Videos of those creators" value={meta ? videosContributing : '–'} sub="on record, any month" />
          </div>
          {cur.series.length > 0 && (
            <>
              <p className="wx-hist-note">Our creators' GMV by sales month</p>
              <MonthBars
                months={cur.series.map((s) => s.m)}
                valueOf={(m) => ({ state: 'value', v: cur.series.find((s) => s.m === m).v })}
                onLabel={cellText}
              />
            </>
          )}
          {meta && meta.truncated && (
            <p className="wx-hist-note">
              Euka reports this brand's top 50 creators only{meta.floor !== null ? `, down to ${usd(meta.floor)}` : ''}. A creator who is
              not in it shows "under" that figure, not $0.
            </p>
          )}
        </section>

        <section className="wx-hist-card">
          <div className="wx-hist-bar-head">
            <h3>Every creator we have paid for {cur.name}</h3>
            <input type="search" placeholder="Search creator or @handle" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              <option value="gmv">Sort: {monthLabel(gmvMonth)} GMV</option>
              <option value="life">Sort: lifetime GMV</option>
              <option value="recent">Sort: latest hire</option>
              <option value="name">Sort: name</option>
            </select>
          </div>
          <div className="wx-hist-scroll">
            <table className="wx-hist-table">
              <thead>
                <tr>
                  <th>Creator</th>
                  <th>Collaborated</th>
                  <th>Status</th>
                  <th>Products</th>
                  <th className="r">Videos</th>
                  <th className="r">{monthLabel(gmvMonth)} GMV</th>
                  <th className="r">Lifetime GMV</th>
                  <th>Latest GMV</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, cell, life, latest }) => (
                  <tr key={p.key} className="click" onClick={() => setPersonKey(p.key)}>
                    <td>
                      <span className="wx-hist-who-cell">
                        {Face ? <Face handle={p.handles[0]} name={p.name} size={32} /> : <span className="wx-hist-logo init" style={{ width: 32, height: 32 }}>{p.name[0]}</span>}
                        <span>
                          <b>{p.name}</b>
                          {p.handles[0] && <em>@{p.handles[0]}</em>}
                        </span>
                      </span>
                    </td>
                    <td>{p.hireMonths.map((m) => monthLabel(m).split(' ')[0]).join(', ') || '–'}</td>
                    <td>
                      {(p.last && p.last.payment_status) || '–'}
                      {p.last && p.last.videos ? ` · ${p.last.videos}` : ''}
                    </td>
                    <td className="clip" title={p.products.join(', ')}>
                      {p.products[0] ? p.products[0] + (p.products.length > 1 ? ` +${p.products.length - 1}` : '') : '–'}
                    </td>
                    <td className="r">{p.videos.length || '–'}</td>
                    <td className="r">
                      <Cell cell={cell} />
                    </td>
                    <td className="r">{months.size ? usd(life) : '–'}</td>
                    <td>{latest ? monthLabel(latest) : '–'}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="wx-hist-note">
                      No creators match.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  /* ── brand list ── */
  const s = search.trim().toLowerCase();
  const list = brands.filter((b) => !s || b.name.toLowerCase().includes(s)).sort((a, b) => b.last.localeCompare(a.last));
  return (
    <div className="wx-hist">
      <div className="wx-hist-bar-head">
        <h3>History · every brand we have worked with</h3>
        <input type="search" placeholder="Search brands" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {q.isError && <p className="wx-hist-note">Monthly GMV could not be read, so GMV figures show a dash. The collaboration history below is complete.</p>}
      <div className="wx-hist-grid">
        {list.map((b) => (
          <button key={b.name} type="button" className="wx-hist-card wx-hist-brand" onClick={() => { setBrand(b.name); setSearch(''); }}>
            <header>
              <Mark name={b.name} />
              <span>
                <b>{b.name}</b>
                <em>last hired {b.last ? b.last.slice(0, 10) : '–'}</em>
              </span>
            </header>
            <dl>
              <div>
                <dt>Creators</dt>
                <dd>{b.people.length}</dd>
              </div>
              <div>
                <dt>Paid collabs</dt>
                <dd>{b.rows.length}</dd>
              </div>
              <div>
                <dt>GMV</dt>
                <dd title={b.firstMonth ? `Our creators, since ${monthLabel(b.firstMonth)}` : 'No months read'}>{b.series.length ? usd(b.lifetime) : '–'}</dd>
              </div>
            </dl>
            {b.series.length > 0 && (
              <MonthBars months={b.series.slice(-8).map((x) => x.m)} valueOf={(m) => ({ state: 'value', v: b.series.find((x) => x.m === m).v })} onLabel={cellText} />
            )}
          </button>
        ))}
        {list.length === 0 && <p className="wx-hist-note">No brands match.</p>}
      </div>
    </div>
  );
}
