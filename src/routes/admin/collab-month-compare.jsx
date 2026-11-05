/**
 * THIS MONTH AGAINST LAST, FOR ONE BRAND.
 *
 * Rashid, 2026-11-04: "a data comparison between selected month and
 * selected-1 month ... also tell which creators we worked with last month are
 * also working with us the current month".
 *
 * OURS, NOT THE VENDORED COPY'S. The brand drilldown in `WurxUI.jsx` is a
 * verbatim copy of WurxBase, so this lives here and is mounted from there on one
 * fenced line. The helpers it needs (deal parsing, delivered-video counting, the
 * once-per-video totals) are handed in rather than imported, because importing
 * them back from `WurxUI` would be a circular import.
 *
 * WHAT A "MONTH" IS HERE. The contract cycle: a creator row belongs to the month
 * of its `hiring_date`, exactly as the budget, allocated and paid cards on the
 * same screen do. Views and GMV are the totals of that month's creators' videos,
 * not of the videos posted in that calendar month, so this compares like with
 * like with the cards above it.
 *
 * WHO COUNTS AS THE SAME CREATOR. The TikTok handle, lower-cased, with the @ and
 * any profile URL stripped, and either of a creator's two accounts matching
 * either of the other's. A name is only used when a row has no handle at all,
 * because two people can share a first name and one person can be typed three
 * ways.
 *
 * NOTHING IS INVENTED. A month with no creators shows dashes, not zeros, and a
 * change against a month of nothing is "new", not "+∞%".
 */
import { useMemo, useState } from 'react';

export const prevMonthKey = (month) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo < 1) {
    mo = 12;
    y -= 1;
  }
  return `${y}-${String(mo).padStart(2, '0')}`;
};

export const handleKey = (raw) => {
  if (!raw) return '';
  let t = String(raw)
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
  if (t.includes('/')) t = t.split('/').pop() || '';
  return t.replace(/^@+/, '');
};

/** Every identity a creator row answers to: its handles, else its name. */
export const identitiesOf = (c) => {
  const ids = [c && c.tiktok_account, c && c.tiktok_account_2].map(handleKey).filter(Boolean);
  if (ids.length) return ids.map((h) => `h:${h}`);
  const n = String((c && c.name) || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
  return n ? [`n:${n}`] : [];
};

/** Everything about one month's creators that the comparison shows. */
export function summarise(rows, helpers) {
  const { parseDealAmount, parseDealVideos, deliveredVideoCount, wxVideoTotals } = helpers;
  let allocated = 0,
    paid = 0,
    videos = 0,
    delivered = 0;
  rows.forEach((c) => {
    const amt = parseDealAmount(c.deal);
    allocated += amt;
    if (c.payment_status === 'Paid') paid += amt;
    videos += parseDealVideos(c.deal);
    delivered += deliveredVideoCount(c);
  });
  const t = wxVideoTotals(rows);
  return {
    creators: rows.length,
    allocated,
    paid,
    videos,
    delivered,
    views: t.views,
    gmv: t.gmv,
    costPerVideo: videos > 0 ? allocated / videos : 0,
    completion: videos > 0 ? (delivered / videos) * 100 : 0,
  };
}


/**
 * THE LAST THREE MONTHS, ONE PLACE PER CREATOR.
 *
 * Rashid, 2026-11-05: "the repeated creators of September that worked in October
 * will be displayed in October only, and the creators of September who are no
 * longer with us will also be shown."
 *
 * So a creator is listed ONCE, in the newest of the three months they were hired
 * in. Someone hired in Aug, Sep and Oct sits under Oct, with a trail showing the
 * two months before. Someone hired in Aug and Sep but not Oct sits under Sep, as
 * having left after Sep. Someone hired only in Aug sits under Aug. Reading the
 * columns left to right is reading who stayed and who dropped off, month by month.
 */
export function compareMonths(rows, month, budgets, brand, helpers) {
  const m1 = prevMonthKey(month);
  const m2 = prevMonthKey(m1);
  const months = [m2, m1, month];
  const inMonth = (mk) => rows.filter((c) => String(c.hiring_date || '').slice(0, 7) === mk);
  const monthRows = months.map(inMonth);

  /* Who is in which month. A creator hired twice in one month is one person. */
  const index = (list) => {
    const byId = new Map();
    const people = [];
    list.forEach((c) => {
      const ids = identitiesOf(c);
      let p = ids.map((i) => byId.get(i)).find(Boolean);
      if (!p) {
        p = { name: c.name || ids[0] || 'Unnamed', handle: '', rows: [] };
        people.push(p);
      }
      p.rows.push(c);
      if (!p.handle) p.handle = handleKey(c.tiktok_account) || handleKey(c.tiktok_account_2);
      ids.forEach((i) => byId.set(i, p));
    });
    return { byId, people };
  };
  const idx = monthRows.map(index);

  const matchIn = (ix, p) => {
    for (const row of p.rows)
      for (const i of identitiesOf(row)) {
        const hit = ix.byId.get(i);
        if (hit) return hit;
      }
    return null;
  };
  const figures = (p) => {
    const s = summarise(p.rows, helpers);
    return { videos: s.videos, delivered: s.delivered, gmv: s.gmv };
  };

  /* Walk from the newest month back; a person already placed later is skipped. */
  const columns = months.map((mk, i) => ({ month: mk, i, people: [], count: idx[i].people.length }));
  for (let i = 2; i >= 0; i--) {
    idx[i].people.forEach((p) => {
      const trail = idx.map((ix, j) => (j === i ? true : !!matchIn(ix, p)));
      if (trail.slice(i + 1).some(Boolean)) return;
      columns[i].people.push({
        name: p.name,
        handle: p.handle,
        trail,
        returning: trail.slice(0, i).some(Boolean),
        fig: figures(p),
      });
    });
    columns[i].people.sort((x, y) => y.fig.gmv - x.fig.gmv);
  }

  /* Of the people hired in one month, how many were hired again the next. */
  const flow = (a, b) => {
    const total = idx[a].people.length;
    const stayed = idx[a].people.filter((p) => matchIn(idx[b], p)).length;
    return { from: months[a], to: months[b], total, stayed, pct: total > 0 ? (stayed / total) * 100 : null };
  };

  return { month, months, columns, flows: [flow(0, 1), flow(1, 2)] };
}

/* ─── the screen ───────────────────────────────────────────────────────── */

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n) => `${Math.round(n)}%`;
const FIRST = 7;

/** One dot per month up to the column's own, filled where the creator was hired. */
function Trail({ trail, labels, upto }) {
  return (
    <span className="wx-cmp-trail">
      {trail.slice(0, upto + 1).map((on, j) => (
        <i
          key={j}
          className={on ? 'on' : ''}
          title={`${labels[j]}: ${on ? 'hired' : 'not hired'}`}
        />
      ))}
    </span>
  );
}

function PersonRow({ p, Face, labels, col }) {
  const f = p.fig;
  const videos = f.videos > 0 ? `${f.delivered}/${f.videos} videos` : 'No deal size';
  return (
    <li className="wx-cmp-row">
      {Face ? (
        <Face handle={p.handle} name={p.name} size={36} />
      ) : (
        <span className="wx-cmp-initial">{(p.name || '?')[0].toUpperCase()}</span>
      )}
      <span className="wx-cmp-who">
        <b>{p.name}</b>
        {p.handle && <em>@{p.handle}</em>}
      </span>
      {col > 0 && <Trail trail={p.trail} labels={labels} upto={col} />}
      <span className="wx-cmp-fig">
        <b>{videos}</b>
        {f.gmv > 0 && <em>{usd(f.gmv)} GMV</em>}
      </span>
    </li>
  );
}

function Column({ col, title, sub, tone, Face, labels, filters }) {
  const [all, setAll] = useState(false);
  const [which, setWhich] = useState('all');
  const list =
    which === 'all'
      ? col.people
      : col.people.filter((p) => (which === 'returning' ? p.returning : !p.returning));
  const shown = all ? list : list.slice(0, FIRST);
  const nBack = col.people.filter((p) => p.returning).length;
  return (
    <section className={`wx-cmp-people ${tone}`}>
      <header>
        <span className="wx-cmp-dot" aria-hidden />
        <h4>{title}</h4>
        <span className="wx-cmp-count">{col.people.length}</span>
      </header>
      <p className="wx-cmp-hint">{sub}</p>
      {filters && col.people.length > 0 && (
        <div className="wx-cmp-chips" role="tablist">
          {[
            ['all', `All ${col.people.length}`],
            ['returning', `Returning ${nBack}`],
            ['new', `New ${col.people.length - nBack}`],
          ].map(([k, t]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={which === k}
              className={which === k ? 'on' : ''}
              onClick={() => {
                setWhich(k);
                setAll(false);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {list.length === 0 ? (
        <p className="wx-cmp-none">Nobody.</p>
      ) : (
        <ul>
          {shown.map((p, i) => (
            <PersonRow
              key={`${p.handle || p.name}-${i}`}
              p={p}
              Face={Face}
              labels={labels}
              col={col.i}
            />
          ))}
        </ul>
      )}
      {list.length > FIRST && (
        <button type="button" className="wx-cmp-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </section>
  );
}

export function BrandMonthCompare({ brand, month, allTime, rows, budgets, helpers, monthLabel }) {
  const [open, setOpen] = useState(true);
  const cmp = useMemo(
    () => (allTime || !month ? null : compareMonths(rows || [], month, budgets, brand, helpers)),
    [rows, month, allTime, budgets, brand, helpers]
  );
  /* All Time has no "last month", so there is nothing honest to compare. */
  if (!cmp) return null;

  const lbl = (k) => (monthLabel ? monthLabel(k) : k);
  const short = (k) => lbl(k).split(' ')[0];
  const labels = cmp.months.map(short);
  const Face = helpers && helpers.CreatorFace;
  const [c0, c1, c2] = cmp.columns;
  /* The oldest month is dropped when nobody was hired in it: an empty column
     says nothing and takes a third of the width. */
  const showOldest = c0.count > 0;
  const flows = cmp.flows.filter((f) => f.total > 0);

  return (
    <div className="wx-cmp" data-wx="month-compare">
      <button
        type="button"
        className="wx-cmp-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wx-cmp-titles">
          <span className="wx-cmp-title">
            {lbl(cmp.month)} · last three months
            {cmp.month === new Date().toISOString().slice(0, 7) ? ' · month in progress' : ''}
          </span>
          <span className="wx-cmp-sub">
            Each creator is listed once, in the latest month they were hired.
          </span>
        </span>
        <span className="wx-cmp-flows">
          {flows.map((f) => (
            <span
              key={f.from}
              className="wx-cmp-flow"
              title={`${f.stayed} of ${f.total} creators hired in ${lbl(f.from)} were hired again in ${lbl(f.to)}`}
            >
              <em>
                {short(f.from)} → {short(f.to)}
              </em>
              <span className="wx-cmp-retbar">
                <i style={{ width: `${Math.min(100, Math.max(0, f.pct))}%` }} />
              </span>
              <b>{pct(f.pct)}</b>
              <small>
                {f.stayed}/{f.total} stayed
              </small>
            </span>
          ))}
        </span>
        <span className="wx-cmp-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <>
          <div className={`wx-cmp-cols${showOldest ? ' three' : ''}`}>
            {showOldest && (
              <Column
                col={c0}
                title={`Left after ${short(c0.month)}`}
                sub={`Hired in ${lbl(c0.month)}, not since`}
                tone="dropped"
                Face={Face}
                labels={labels}
              />
            )}
            <Column
              col={c1}
              title={`Left after ${short(c1.month)}`}
              sub={`Hired in ${lbl(c1.month)}, not in ${lbl(c2.month)}`}
              tone="dropped"
              Face={Face}
              labels={labels}
            />
            <Column
              col={c2}
              title={`Working with us in ${short(c2.month)}`}
              sub={`Hired in ${lbl(c2.month)}`}
              tone="stayed"
              Face={Face}
              labels={labels}
              filters
            />
          </div>
          <p className="wx-cmp-foot">
            Dots show which of the three months a creator was hired in. Returning means hired in an
            earlier month too; the same TikTok handle counts as the same creator. Figures are for
            the month they are listed under.
          </p>
        </>
      )}
    </div>
  );
}
