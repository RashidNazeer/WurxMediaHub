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
        /* What they did in each of the three months, or null where not hired. */
        figs: idx.map((ix, j) => (trail[j] ? figures(j === i ? p : matchIn(ix, p)) : null)),
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

const FIRST = 8;

/** The real current month, `YYYY-MM`. The comparison always ends here. */
const thisMonthKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** One month's cell: videos delivered out of committed, or a faint dash. */
function Cell({ fig, now }) {
  if (!fig) return <span className="wx-cmp-cell off" aria-label="not hired">–</span>;
  const text = fig.videos > 0 ? `${fig.delivered}/${fig.videos}` : 'Hired';
  return <span className={`wx-cmp-cell on${now ? ' now' : ''}`}>{text}</span>;
}

function Group({ title, tone, people, Face }) {
  const [all, setAll] = useState(false);
  if (people.length === 0) return null;
  const shown = all ? people : people.slice(0, FIRST);
  return (
    <div className={`wx-cmp-group ${tone}`}>
      <div className="wx-cmp-grouphead">
        <span className="wx-cmp-dot" aria-hidden />
        <b>{title}</b>
        <span>{people.length}</span>
      </div>
      <ul>
        {shown.map((p, i) => (
          <li key={`${p.handle || p.name}-${i}`} className="wx-cmp-row">
            <span className="wx-cmp-id">
              {Face ? (
                <Face handle={p.handle} name={p.name} size={34} />
              ) : (
                <span className="wx-cmp-initial">{(p.name || '?')[0].toUpperCase()}</span>
              )}
              <span className="wx-cmp-who">
                <b>{p.name}</b>
                {p.handle && <em>@{p.handle}</em>}
              </span>
            </span>
            {p.figs.map((f, j) => (
              <Cell key={j} fig={f} now={j === 2} />
            ))}
          </li>
        ))}
      </ul>
      {people.length > FIRST && (
        <button type="button" className="wx-cmp-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${people.length}`}
        </button>
      )}
    </div>
  );
}

/**
 * Always the real current month and the two before it, whatever the month
 * picker says: "if the current month is November it shows September, October
 * and November" (Rashid, 2026-11-05). `month` and `allTime` are not read.
 */
export function BrandMonthCompare({ brand, rows, budgets, helpers, monthLabel }) {
  const [open, setOpen] = useState(true);
  const anchor = thisMonthKey();
  const cmp = useMemo(
    () => compareMonths(rows || [], anchor, budgets, brand, helpers),
    [rows, anchor, budgets, brand, helpers]
  );

  const lbl = (k) => (monthLabel ? monthLabel(k) : k);
  const short = (k) => lbl(k).split(' ')[0];
  const Face = helpers && helpers.CreatorFace;
  const { columns, flows } = cmp;
  const [c0, c1, c2] = columns;
  const empty = columns.every((c) => c.count === 0);

  const sentence = (f) =>
    f.total > 0
      ? `${f.stayed} of ${short(f.from)}'s ${f.total} were hired again in ${short(f.to)}`
      : null;
  const notes = flows.map(sentence).filter(Boolean);

  return (
    <div className="wx-cmp" data-wx="month-compare">
      <button
        type="button"
        className="wx-cmp-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="wx-cmp-title">Creators, last three months</span>
        <span className="wx-cmp-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open &&
        (empty ? (
          <p className="wx-cmp-none">No creators were hired in the last three months.</p>
        ) : (
          <>
            {notes.length > 0 && <p className="wx-cmp-notes">{notes.join(' · ')}</p>}

            <div className="wx-cmp-grid" role="table">
              <div className="wx-cmp-colhead" role="row">
                <span />
                {columns.map((c, i) => (
                  <span key={c.month} className={i === 2 ? 'now' : ''} role="columnheader">
                    <b>{short(c.month)}</b>
                    <small>
                      {c.count} hired{i === 2 ? ' so far' : ''}
                    </small>
                  </span>
                ))}
              </div>

              <Group
                title={`With us in ${short(c2.month)}`}
                tone="stayed"
                people={c2.people}
                Face={Face}
              />
              <Group
                title={`Left after ${short(c1.month)}`}
                tone="dropped"
                people={c1.people}
                Face={Face}
              />
              <Group
                title={`Left after ${short(c0.month)}`}
                tone="dropped"
                people={c0.people}
                Face={Face}
              />
            </div>
            <p className="wx-cmp-foot">
              Each creator is listed once, under the latest month they were hired. A number is
              videos delivered out of committed; a dash means not hired that month. Same TikTok
              handle means same creator.
            </p>
          </>
        ))}
    </div>
  );
}
