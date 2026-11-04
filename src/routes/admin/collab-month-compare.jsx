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
 * The comparison itself. `rows` is every creator row the brand has, in any
 * month; `month` is the one on screen.
 */
export function compareMonths(rows, month, budgets, brand, helpers) {
  const prev = prevMonthKey(month);
  const inMonth = (mk) => rows.filter((c) => String(c.hiring_date || '').slice(0, 7) === mk);
  const curRows = inMonth(month);
  const prevRows = inMonth(prev);

  const budgetOf = (mk) => {
    const b = (budgets || []).find((x) => x.brand === brand && x.month === mk);
    return b ? Number(b.budget) || 0 : 0;
  };

  const cur = { ...summarise(curRows, helpers), budget: budgetOf(month) };
  const old = { ...summarise(prevRows, helpers), budget: budgetOf(prev) };

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
  const a = index(prevRows);
  const b = index(curRows);

  const figures = (p) => {
    const s = summarise(p.rows, helpers);
    return { allocated: s.allocated, videos: s.videos, delivered: s.delivered, gmv: s.gmv };
  };
  const matchIn = (idx, p) => {
    for (const row of p.rows)
      for (const i of identitiesOf(row)) {
        const hit = idx.byId.get(i);
        if (hit) return hit;
      }
    return null;
  };

  const stayed = [],
    dropped = [],
    joined = [];
  a.people.forEach((p) => {
    const now = matchIn(b, p);
    if (now)
      stayed.push({
        name: now.name,
        handle: now.handle || p.handle,
        before: figures(p),
        now: figures(now),
      });
    else dropped.push({ name: p.name, handle: p.handle, before: figures(p) });
  });
  b.people.forEach((p) => {
    if (!matchIn(a, p)) joined.push({ name: p.name, handle: p.handle, now: figures(p) });
  });

  const byGmv = (x, y) => (y.now || y.before).gmv - (x.now || x.before).gmv;
  stayed.sort(byGmv);
  dropped.sort(byGmv);
  joined.sort(byGmv);

  return {
    month,
    prev,
    cur,
    old,
    people: { before: a.people.length, now: b.people.length },
    stayed,
    dropped,
    joined,
    retention: a.people.length > 0 ? (stayed.length / a.people.length) * 100 : null,
  };
}

/* ─── the screen ───────────────────────────────────────────────────────── */

const usd = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const pct = (n) => `${Math.round(n)}%`;
const FIRST = 6;

/**
 * One creator: face, name, handle, and the single figure that matters for the
 * column they are in (videos done, plus GMV when there is any to show).
 */
function PersonRow({ p, fig, Face }) {
  const videos = fig.videos > 0 ? `${fig.delivered}/${fig.videos} videos` : 'No deal size';
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
      <span className="wx-cmp-fig">
        <b>{videos}</b>
        {fig.gmv > 0 && <em>{usd(fig.gmv)} GMV</em>}
      </span>
    </li>
  );
}

function PeopleList({ title, tone, items, figOf, Face }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <section className={`wx-cmp-people ${tone}`}>
      <header>
        <span className="wx-cmp-dot" aria-hidden />
        <h4>{title}</h4>
        <span className="wx-cmp-count">{items.length}</span>
      </header>
      {items.length === 0 ? (
        <p className="wx-cmp-none">Nobody.</p>
      ) : (
        <ul>
          {shown.map((p, i) => (
            <PersonRow key={`${p.handle || p.name}-${i}`} p={p} fig={figOf(p)} Face={Face} />
          ))}
        </ul>
      )}
      {items.length > FIRST && (
        <button type="button" className="wx-cmp-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
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

  const noPrev = cmp.old.creators === 0;
  const lbl = (k) => (monthLabel ? monthLabel(k) : k);
  const Face = helpers && helpers.CreatorFace;

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
            {lbl(cmp.month)} vs {lbl(cmp.prev)}
            {cmp.month === new Date().toISOString().slice(0, 7) ? ' · month in progress' : ''}
          </span>
          <span className="wx-cmp-sub">
            {noPrev
              ? `No creators were hired in ${lbl(cmp.prev)}`
              : `${cmp.stayed.length} of ${cmp.people.before} creators from ${lbl(cmp.prev)} are back`}
          </span>
        </span>
        {!noPrev && cmp.retention != null && (
          <span
            className="wx-cmp-ret"
            title={`${pct(cmp.retention)} of ${lbl(cmp.prev)}'s creators were hired again`}
          >
            <span className="wx-cmp-retbar">
              <i style={{ width: `${Math.min(100, Math.max(0, cmp.retention))}%` }} />
            </span>
            <b>{pct(cmp.retention)}</b>
            <em>retained</em>
          </span>
        )}
        <span className="wx-cmp-chev" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>

      {open && (
        <>
          <div className="wx-cmp-cols">
            <PeopleList
              title="Back again"
              tone="stayed"
              items={cmp.stayed}
              figOf={(p) => p.now}
              Face={Face}
            />
            <PeopleList
              title="Not back"
              tone="dropped"
              items={cmp.dropped}
              figOf={(p) => p.before}
              Face={Face}
            />
            <PeopleList
              title="New"
              tone="joined"
              items={cmp.joined}
              figOf={(p) => p.now}
              Face={Face}
            />
          </div>
          <p className="wx-cmp-foot">
            Back again: hired in {lbl(cmp.prev)} and {lbl(cmp.month)}. Not back: hired in{' '}
            {lbl(cmp.prev)} only. New: hired in {lbl(cmp.month)} only. Same TikTok handle means
            same creator.
          </p>
        </>
      )}
    </div>
  );
}
